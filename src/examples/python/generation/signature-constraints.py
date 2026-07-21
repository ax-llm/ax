# ax-example:start
# title: Python Signature Constraints
# group: generation
# description: Builds a constrained signature fluently and runs it with OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 40
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, f


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
signature = (
    f()
    .input("requestText", f.string("Booking request").min(10).max(500))
    .input("contactEmail", f.string("Contact email").email())
    .output("partySize", f.number("Guests").min(1).max(12))
    .output(
        "bookingCode",
        f.string("Three letters, a dash, and four digits").regex(
            r"^[A-Z]{3}-\d{4}$", "Must look like ABC-1234"
        ),
    )
    .output(
        "guestProfile",
        f.object(
            {
                "fullName": f.string("Primary guest").min(2),
                "dietaryNotes": f.string("Dietary requirements").optional(),
            }
        ),
    )
    .build()
)
output = ax(signature).forward(
    client,
    {
        "requestText": "Book dinner for four people under the name Ada Lovelace.",
        "contactEmail": "ada@example.com",
    },
)
print(json.dumps(output, indent=2, sort_keys=True))
