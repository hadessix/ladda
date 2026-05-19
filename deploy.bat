git add .
git commit -m "1.6 windowfix01 "
git push
wrangler pages deploy . --project-name=ladda --commit-dirty=true
