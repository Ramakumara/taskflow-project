import pandas as pd
import pickle

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LinearRegression

# load dataset
df = pd.read_csv(
    "tasks.csv"
)

# -----------------
# DATA CLEANING
# -----------------

# remove duplicates
df = df.drop_duplicates()

# fill null values
df["priority"] = df["priority"].fillna("medium")
df["task_title"] = df["task_title"].fillna("")
df["description"] = df["description"].fillna("")
df["number_of_users"] = df["number_of_users"].fillna(1)

# normalize text
df["priority"] = df["priority"].str.lower()

# priority encoding
priority_map = {
    "low": 1,
    "medium": 2,
    "high": 3
}

df["priority"] = df["priority"].map(priority_map)

# inputs
X = df[
    [
        "priority",
        "task_title",
        "description",
        "number_of_users"
    ]
]

# output
y = df["days"]

# -----------------
# FEATURE ENGINEERING
# -----------------

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

# model pipeline
model = Pipeline([
    ("preprocessor", preprocessor),
    ("regressor", LinearRegression())
])

# train
model.fit(X, y)

# save
pickle.dump(
    model,
    open("model.pkl", "wb")
)

print("Model trained")