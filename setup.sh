#!/bin/bash

if ! [ $(id -u) = 0 ]; then
   echo "Must run as root!"
   exit 1
fi


docker-compose up -d --build
sleep 5

docker-compose run web python3 manage.py migrate

docker-compose run web python3 manage.py collectstatic

docker-compose run web python3 manage.py createsuperuser

chown -R www-data /opt/sock
