# ax-example:start
# title: Python Date Fields
# group: generation
# description: Parses date, datetime and range outputs into ISO 8601 by default as TypeScript does, and passes a native datetime as an input.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 47
# ax-example:end
import datetime
import os

from axllm import ai, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-6-luna"),
)

# Date outputs parse by default; set parseDates (or parse_dates) to false to keep text.
planner = ax(
    'emailText:string, sentAt:datetime -> meetingStartsAt:datetime "Start time with its time zone", '
    'meetingDay:date, travelWindow:dateRange "First and last day away"',
)
out = planner.forward(
    client,
    {
        "emailText": "Can we meet next Tuesday at 3pm New York time? I'm travelling from the 8th to the 12th.",
        # A native datetime is rendered as TypeScript renders a Date.
        "sentAt": datetime.datetime(2024, 5, 2, 16, 30, tzinfo=datetime.timezone.utc),
    },
)
print(out["meetingStartsAt"])  # e.g. 2024-05-07T19:00:00.000Z
print(out["meetingDay"])  # e.g. 2024-05-07T00:00:00.000Z
print(out["travelWindow"])  # {'start': '2024-05-08T00:00:00.000Z', 'end': ...}
