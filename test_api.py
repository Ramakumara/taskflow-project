import requests

try:
    # Just checking if the route exists or if it returns 404
    r = requests.post("http://127.0.0.1:8000/api/invitations/send", json={"email": "test@test.com", "role": "user"})
    print(r.status_code)
    print(r.text)
except Exception as e:
    print(e)
