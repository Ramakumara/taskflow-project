from authlib.integrations.starlette_client import OAuth
import os
from dotenv import load_dotenv


oauth = OAuth()

def init_oauth(app):
    oauth.register(
        name='google',
        client_id= os.getenv("client_id"),
        client_secret= os.getenv("client_secret"),
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={
            'scope': 'openid email profile'
        }
    )
    return oauth