with open(r'c:\Users\Ram\OneDrive\Desktop\TaskFlow\frontend\javascript\admin.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()
    for i, line in enumerate(lines):
        if 'async function sendInvitation' in line:
            for j in range(i, i+50):
                print(lines[j].rstrip())
            break
