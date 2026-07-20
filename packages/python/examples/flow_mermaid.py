from axllm import flow


source = """flowchart TD
  %%ax classify: requestText:string -> route:class \"support, sales\"
  %%ax reply: requestText:string -> replyText:string(max 300)
  classify{route} -->|support| reply
"""

program = flow(source)
rendered = str(program)
assert "%%ax reply: requestText:string -> replyText:string(max 300)" in rendered
assert "classify -->|support| reply" in rendered
assert str(flow(rendered)) == rendered
print("python-flow-mermaid-ok")
