package axir

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// quotedStringModule is canonically formatted. Quoted strings that start
// with @ or % fill every literal slot, next to real refs spelled the same.
const quotedStringModule = `module @quoted version "0.1" {
  dialect @core version "0.1"

  op core.func @demo {
    attr aliases = ["%d", "@demo", %d, @demo]
    attr doc = "@deprecated: use %s"
    type signature = "(string, map) -> string throws"
    body @entry(%d: string, %m: map) {
      %same = core.call intrinsic.eq(%d, "%d")
      %stamp = core.call intrinsic.regex.replace("@\\d{8}$", "", %d)
      %pct = core.const "%d"
      %byref = core.get %m[%d]
      %got = core.get %m["%d"] default "@none"
      core.set %m["@type"] = "%s: %s"
      %items = core.list
      core.append %items, "%"
      %joined = core.string_join %items sep "%%"
      %tagged = core.regex_match %d pattern "@\\w+"
      core.if %same {
        core.raise "%d items failed"
      }
      core.return "%done"
    }
  }
}
`

func TestFormatRoundTripKeepsQuotedAtAndPercentStrings(t *testing.T) {
	mod, err := ParseModule(quotedStringModule, "quoted.axir")
	if err != nil {
		t.Fatal(err)
	}
	fn := mod.Ops[0]
	if aliases, _ := Attr(fn, "aliases"); !reflect.DeepEqual(aliases.Values, []interface{}{QuotedString("%d"), QuotedString("@demo"), "%d", "@demo"}) {
		t.Fatalf("quoted strings and refs collapsed in a list attr: %#v", aliases.Values)
	}
	body := fn.Regions[0].Blocks[0].Ops
	if args, _ := Attr(body[0], "args"); !reflect.DeepEqual(args.Values, []interface{}{"%d", QuotedString("%d")}) {
		t.Fatalf("quoted %%d collapsed into the %%d ref: %#v", args.Values)
	}
	if args, _ := Attr(body[1], "args"); args.Values[0] != QuotedString(`@\d{8}$`) {
		t.Fatalf("regex literal not kept as a quoted string: %#v", args.Values)
	}
	if byRef, byLiteral := attrRaw(body[3], "key"), attrRaw(body[4], "key"); byRef != "%d" || byLiteral != QuotedString("%d") {
		t.Fatalf("core.get keys: ref %#v, literal %#v", byRef, byLiteral)
	}
	raise := body[10].Regions[0].Blocks[0].Ops[0]
	if _, ok := Attr(raise, "error"); ok || attrRaw(raise, "message") != QuotedString("%d items failed") {
		t.Fatalf("quoted raise text must stay a message: %#v", raise.Attributes)
	}

	text := FormatModuleCompact(mod)
	if text != quotedStringModule {
		t.Fatalf("format did not keep quoted @/%% strings quoted and refs bare:\n%s", text)
	}
	again, err := ParseModule(text, "quoted.axir")
	if err != nil {
		t.Fatalf("formatted module did not parse:\n%s\n%v", text, err)
	}
	if !reflect.DeepEqual(again, mod) {
		t.Fatalf("parse -> format -> parse changed the module:\nbefore %#v\nafter  %#v", mod, again)
	}
	if _, err := BuildCoreBody(again.Ops[0]); err != nil {
		t.Fatalf("quoted strings were read as value refs: %v", err)
	}
}

func TestFormatValuePrintsOnlyRefTokensBare(t *testing.T) {
	for _, tc := range []struct {
		value interface{}
		want  string
	}{
		{"%d", `%d`},
		{"@core.call-x_1", `@core.call-x_1`},
		{QuotedString("%d"), `"%d"`},
		{QuotedString(`@\d{8}$`), `"@\\d{8}$"`},
		// Plain strings that are not one ref token print quoted, never as
		// text the lexer cannot read back.
		{`@\d{8}$`, `"@\\d{8}$"`},
		{"%s: %s", `"%s: %s"`},
		{"plain", `"plain"`},
	} {
		if got := formatValue(tc.value); got != tc.want {
			t.Errorf("formatValue(%#v) = %s, want %s", tc.value, got, tc.want)
		}
	}
}

// TestFormatAxCoreModulesReachFixedPoint runs axir fmt's formatter over the
// checked-in modules: the output must parse and format to itself.
func TestFormatAxCoreModulesReachFixedPoint(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(repoRootPath(), "ir", "axcore", "*.axir"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no ir/axcore modules found")
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		mod, err := ParseModule(string(raw), file)
		if err != nil {
			t.Fatal(err)
		}
		once := FormatModuleCompact(mod)
		again, err := ParseModule(once, file)
		if err != nil {
			t.Errorf("formatted %s does not parse: %v", file, err)
			continue
		}
		if FormatModuleCompact(again) != once {
			t.Errorf("formatting %s is not a fixed point", file)
		}
	}
}

func TestEmittersCompileQuotedPercentStringsAsLiterals(t *testing.T) {
	mod, err := ParseModule(`module @quoted version "0.1" {
  dialect @core version "0.1"

  op core.func @demo {
    type signature = "(string, map) -> bool"
    body @entry(%d: string, %m: map) {
      %same = core.call intrinsic.eq(%d, "%d")
      core.set %m["%d"] = "@d"
      core.return %same
    }
  }
}
`, "quoted.axir")
	if err != nil {
		t.Fatal(err)
	}
	op := mod.Ops[0]
	names := map[string]string{"demo": "demo"}
	for _, tc := range []struct {
		lang string
		emit func() (string, error)
		want []string
	}{
		{"python", func() (string, error) {
			st := &pythonEmitState{names: names, moduleOf: map[string]string{}, module: "demo", imports: map[string]map[string]bool{}}
			return emitPythonCoreFunction(st, op, "demo")
		}, []string{`same = _core_eq(d, "%d")`, `m["%d"] = "@d"`}},
		{"java", func() (string, error) { return emitJavaCoreFunction(names, op, "demo") },
			[]string{`Core.eq(d, "%d")`, `Core.set(m, "%d", "@d");`}},
		{"go", func() (string, error) { return emitGoCoreFunction(names, op, "demo") },
			[]string{`_core_eq(v_d, "%d")`, `coreSet(v_m, "%d", "@d")`}},
		{"cpp", func() (string, error) { return emitCppCoreFunction(names, op, "demo") },
			[]string{`Core::eq(d, Value("%d"))`, `Core::set(m, Value("%d"), Value("@d"));`}},
		{"rust", func() (string, error) { return emitRustCoreFunction(names, op, "demo") },
			[]string{`core_eq(&[v_d.clone(), CoreValue::from("%d")])`, `core_set(&v_m, CoreValue::from("%d"), CoreValue::from("@d"))`}},
	} {
		out, err := tc.emit()
		if err != nil {
			t.Fatalf("%s: %v", tc.lang, err)
		}
		for _, want := range tc.want {
			if !strings.Contains(out, want) {
				t.Errorf("%s: quoted %%d must compile as a string, missing %q in:\n%s", tc.lang, want, out)
			}
		}
	}
}

func TestCheckersReadQuotedStringsAsLiterals(t *testing.T) {
	bundle, symbols := parseTypeFixture(t, typeFixture(`  op core.func @quoted_const {
    type signature = "(json) -> json"
    body @entry(%value: json) {
      %label = core.const "%value"
      core.append %label, %value
      core.return %label
    }
  }

  op core.func @quoted_type_slot {
    type endpoint = "@handler"
  }`))
	usage := CheckTypeUsage(bundle, symbols, CheckOptions{})
	if got := diagnosticsContaining(t, usage, "warning", "core.append target is %label, which has kind string"); got != 1 {
		t.Fatalf("quoted %%value const must have kind string, not the %%value ref's json (%v)", usage)
	}
	types := CheckTypes(bundle, symbols)
	if got := diagnosticsContaining(t, types, "error", "@quoted_type_slot type endpoint"); got != 1 {
		t.Fatalf("quoted @ type value must still be checked (%v)", types)
	}
}

func TestLexDecodesStringEscapes(t *testing.T) {
	tokens, err := lex(`"a\r\nb\tc\"d\\e"`)
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) == 0 || tokens[0].kind != "string" {
		t.Fatalf("tokens = %+v", tokens)
	}
	if want := "a\r\nb\tc\"d\\e"; tokens[0].text != want {
		t.Fatalf("lex = %q, want %q", tokens[0].text, want)
	}
}

func TestStringEscapeFormatRoundTrip(t *testing.T) {
	values := []string{"\a\b\f\v\x00\r\n\t", "\u2028\u2029\u0085", "🚀", `\r\n\d`, `"quoted"`, "\xff"}
	for ch := byte(0); ch < 128; ch++ {
		values = append(values, string([]byte{ch})+"A7")
	}
	for _, value := range values {
		formatted := formatValue(QuotedString(value))
		tokens, err := lex(formatted)
		if err != nil {
			t.Fatalf("lex(%s): %v", formatted, err)
		}
		if got := tokens[0].text; got != value {
			t.Errorf("format/parse changed %q to %q (%s)", value, got, formatted)
		}
	}
	for _, spelling := range []string{`"\101"`, `"\x41"`, `"\u0041"`, `"\U00000041"`} {
		tokens, err := lex(spelling)
		if err != nil || tokens[0].text != "A" {
			t.Errorf("lex(%s) = %v, %v", spelling, tokens, err)
		}
	}
}

func TestLexRejectsInvalidStringEscapes(t *testing.T) {
	for _, value := range []string{`"\q"`, `"\x0"`, `"\u202"`, `"\uZZZZ"`, `"\U00110000"`, `"\uD800"`, `"unterminated`, `"""unterminated`, `"trailing\`} {
		if _, err := lex(value); err == nil {
			t.Errorf("lex(%s) silently accepted invalid string", value)
		}
	}
	if _, err := ParseModule("module @test {\n  op core.func @demo { attr doc = \"\\q\" }\n}", "invalid.axir"); err == nil || !strings.Contains(err.Error(), "invalid.axir:2: invalid string escape") {
		t.Fatalf("missing source location for invalid escape: %v", err)
	}
	if tokens, err := lex(`"""\q\r\n"""`); err != nil || tokens[0].text != `\q\r\n` {
		t.Fatalf("raw strings must preserve backslashes: %v, %v", tokens, err)
	}
}
