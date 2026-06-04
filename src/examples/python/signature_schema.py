import json

from axllm import s


signature = s("question:string -> answer:string")
schema = signature.to_json_schema("outputs")

print(json.dumps(schema, indent=2, sort_keys=True))
