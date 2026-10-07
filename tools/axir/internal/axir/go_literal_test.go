package axir

import "testing"

func TestGoLiteralKeepsLargeWholeFloatsFloat(t *testing.T) {
	cases := map[float64]string{
		9007199254740991: "9007199254740991.0",
		-4294967296:      "-4294967296.0",
		2147483647:       "2147483647",
		2:                "2",
		0.5:              "0.5",
	}
	for value, want := range cases {
		if got := goLiteral(value); got != want {
			t.Fatalf("goLiteral(%v) = %q, want %q", value, got, want)
		}
	}
}
