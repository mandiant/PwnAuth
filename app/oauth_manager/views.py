from django.urls import get_resolver, get_urlconf
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.reverse import reverse


class Index(APIView):
    """
    Home view for the oauth manager. Serves as a landing page for the overall application and links
    to the installed modules.
    """

    template_name = 'oauth_manager/index.html'

    def get(self, request):
        """
        Return a list of all the installed OAuth modules
        """
        extra, resolver = get_resolver(get_urlconf()).namespace_dict['oauth_manager']

        installed_apps = resolver.app_dict.keys()

        module_links = [{'application': oauth_module, 'url': reverse('oauth_manager:{0}:schema'.format(oauth_module))} for oauth_module in installed_apps]

        return Response({'links': module_links})