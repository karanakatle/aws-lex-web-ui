BuildBucket=lex-web-ui-$(aws sts get-caller-identity |  jq -r ".Account")-$(aws configure get default.region)
aws s3 mb s3://$BuildBucket
sam build --template-file lexbot.yaml
sam build --template-file codebuild-deploy

pip3 install requests -t ./custom-resources

sam package  --s3-bucket $BuildBucket  --template-file codebuild-deploy.yaml --output-template-file package/codebuild-deploy.yaml
sam package  --s3-bucket $BuildBucket  --template-file coderepo.yaml --output-template-file package/coderepo.yaml
sam package  --s3-bucket $BuildBucket  --template-file lexbot.yaml --output-template-file package/lexbot.yaml
sam package  --s3-bucket $BuildBucket  --template-file cognitouserpoolconfig.yaml --output-template-file package/cognitouserpoolconfig.yaml
sam package  --s3-bucket $BuildBucket  --template-file cognito.yaml --output-template-file package/cognito.yaml
sam package  --s3-bucket $BuildBucket  --template-file pipeline.yaml --output-template-file package/pipeline.yaml
sam package  --s3-bucket $BuildBucket  --template-file master-pipeline.yaml --output-template-file package/master-template.yaml

 sam deploy --stack-name lex-web-ui --s3-bucket $BuildBucket  --capabilities "CAPABILITY_NAMED_IAM" --template-file package/master-template.yaml --parameter-overrides GetCodeFromS3=false
# run this if you install Python from Brew
# ln -sf /usr/local/opt/python@3.7/bin/python3.7 /usr/local/bin/