# PwnAuth

A web application framework for launching and managing OAuth abuse campaigns.

## Minimum requirements

* An Internet accessible server (tested running Ubuntu 16.04)
* Nginx
* Docker
* Docker Composer
* A Valid SSL certificate

## Installation


1. Clone the repository onto your server
2. Inside `Dockerfile` customize the settings to your site. Change `DJANGO_SITE` to match the FQDN of the domain you are using. Change the `SECRET_KEY` to a new random value
3. Configure your SSL certificates and NGINX. I have provided a sample NGINX configuration in `nginx/oauth.conf`
2. Run `setup.sh` as root. This will build the docker services for the OAuth application as well as setup an initial Django administrator for you to use the application with.

[See the Wiki for post-installation setup](https://github.com/fireeye/PwnAuth/wiki)

## Modules

PwnAuth is designed to be modular. A new Identity Provider can easily be supported by developing the necessary database models and views to interact with the Resource Server.
As long as you follow the module implementation guidelines, the GUI will automatically detect the module and it will be ready for use.

### Office 365

1. You must create a new OAuth application with microsoft at the [Microsoft App Portal](https://apps.dev.microsoft.com)
2. Be sure to create a secret key and ensure your scopes include `user.read` and `offline_access`
3. Import the application settings into the application using the GUI
4. Send out your phishing emails using the `authorization_url_full` link and wait for responses!

## Usage

PwnAuth is designed to be interacted with inside of a browser. There is also an API available available for power users. To learn more about using PwnAuth see the wiki.
