git add .
git commit -m "update"
git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
