git add .
git commit -m "1.2แก้รายจ่าย2"
git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
