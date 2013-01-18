# Political Screaming Match Code Dump

Expects the following ENV variables to be set on Heroku:

* PORT - e.g 8000 (set automatically by heroku)
* SESSION_SECRET - e.g. random string "dafssahafdhwauiehu243"
* TWILIO_SID - from twilio
* TWILIO_AUTH_TOKEN - from twilio
* PRIMARY_DOMAIN - e.g. politicalscreamingmatch.com
* MONGOLAB_URI - e.g. from mongolab


Potential problem losing twilio URLs if process shuts down during a call - workaround is to manually set the url instead of ussing callbacks like call.on
