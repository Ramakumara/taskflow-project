import pickle
import pandas as pd
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(BASE_DIR, "model.pkl")

model = pickle.load(
    open(model_path, "rb")
)

def predict_days(priority,task_title,description,number_of_users):

    data = pd.DataFrame({
        "priority":[priority],
        "task_title":[task_title],
        "description":[description],
        "number_of_users":[number_of_users]
    })

    prediction = model.predict(data)

    return round(prediction[0])