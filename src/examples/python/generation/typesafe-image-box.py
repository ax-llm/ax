# ax-example:start
# title: Python Jev Image Localization
# group: generation
# description: Locates a red square using image inputs and Box outputs with native confidence.
# provider: typesafe
# env: TYPESAFE_APIKEY
# level: intermediate
# order: 47
# ax-example:end
import base64
import json
import os
from pathlib import Path
from axllm import ai, ax

model = ai("typesafe", api_key=os.environ["TYPESAFE_APIKEY"], model="jev-1.14.0")
# This synthetic image is 384 by 384; Jev requires at least 78,400 pixels.
image = base64.b64encode(Path("src/examples/assets/decision-shapes.png").read_bytes()).decode("ascii")
locate = ax('photo:image -> visible:boolean "Is there a red square in photo?", target:box(evidence) "The red square in photo"')
result = locate.forward(model, {"photo": {"mimeType": "image/png", "data": image}})
# Jev always returns a region, so use it only when the target is present.
if result["visible"]:
    assert result["target"]["provenance"]["source"] == "native"
    print(json.dumps(result["target"], indent=2))
else:
    print("The target was not detected.")
