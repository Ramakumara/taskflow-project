import pandas as pd
import pickle

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LinearRegression

df = pd.read_csv("tasks.csv")

df = df.drop_duplicates()

df["priority"] = df["priority"].fillna("medium").str.lower()
df["task_title"] = df["task_title"].fillna("")
df["description"] = df["description"].fillna("")
df["number_of_users"] = df["number_of_users"].fillna(1)

priority_map = {
    "low": 1,
    "medium": 2,
    "high": 3
}

df["priority"] = df["priority"].map(priority_map)

X = df[
    [
        "priority",
        "task_title",
        "description",
        "number_of_users"
    ]
]

y = df["days"]

preprocessor = ColumnTransformer(
    transformers=[
        (
            "title",
            TfidfVectorizer(),
            "task_title"
        ),
        (
            "desc",
            TfidfVectorizer(),
            "description"
        )
    ],
    remainder="passthrough"
)

model = Pipeline([
    ("preprocessor", preprocessor),
    ("regressor", LinearRegression())
])

model.fit(X, y)

pickle.dump(
    model,
    open("model.pkl", "wb")
)

print("Model trained")