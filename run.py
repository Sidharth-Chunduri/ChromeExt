import subprocess
from datetime import datetime
import time
import random
import string
import os

os.chdir("/Users/sidharthchunduri/Scripts/Project_New")

print("Running at", datetime.now())

num_commits = random.randint(1, 20)

print(f"commit and push{num_commits} times")
for i in range(num_commits):
    str_len = random.randint(20, 60)
    out = "".join(random.choice(string.ascii_letters + string.digits) for _ in range(str_len))

    print(f"commit number: {i + 1}")
    delay = random.randint(0, 3600)
    print(f"Sleeping for {delay} seconds...")
    time.sleep(delay)

    file_path = "/Users/sidharthchunduri/Scripts/Project_new/daily_log.txt"
    with open(file_path, "a") as f:
        f.write(f"{datetime.now()}\n {out}\n")


    subprocess.run(["git", "add", file_path])
    subprocess.run(["git", "commit", "-m", f"{out}"])
    subprocess.run(["git", "push"])
