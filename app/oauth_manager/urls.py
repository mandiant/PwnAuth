from django.conf.urls import url, include

from . import views


app_name = 'oauth_manager'



oauth_app_patterns = [
    url(r'^microsoft/', include('oauth_office365.urls')),
]

urlpatterns = [
    url(r'^$', views.Index.as_view(), name='index'),
    url(r'^api/',include(oauth_app_patterns))

]