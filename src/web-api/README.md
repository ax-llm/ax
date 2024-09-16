# Ax Rome

Chat platform for AI Agents

## Initialize Mongo Replicate Mode

```shell
replication:
  replSetName: rs0
```

```shell
$ mongosh
> rs.initiate()
```

## Development Setup

Install packages needed

```shell
npm i
```

Setup .env file

```
OPENAI_APIKEY=""
MONGO_URI="mongodb://localhost:27017?retryWrites=false"
APP_SECRET="toomanysecrets"
DATA_SECRET="abcdefghijklmnopqrstuvwzyz123456"
PUBLIC_URL="http://localhost:5173"
GOOGLE_ID=""
GOOGLE_SECRET=""
```

Start API server

```shell
cd ax/src/web-api
npm run dev
```

Start Frontend server

```shell
cd ax/src/web-ui
npm run dev
```
