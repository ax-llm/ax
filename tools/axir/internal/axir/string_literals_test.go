package axir

import (
	"context"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Compile the emitter's expressions and compare their actual UTF-8 bytes. This
// catches target-specific escape syntax, C++ greedy hex escapes/NUL truncation,
// and Java chunk boundaries through a multibyte character.
func TestStringLiteralTargetsRoundTrip(t *testing.T) {
	values := []string{`quotes " backslash \ literal \u2028`, "\x01A", "\x00A", "\u0085\u2028\u2029🚀", strings.Repeat("a", 11999) + "🚀\u2028" + strings.Repeat("b", 12000)}
	for ch := byte(0); ch < 32; ch++ {
		values = append(values, string([]byte{ch})+"A7")
	}
	want := make([]string, len(values))
	for i, value := range values {
		want[i] = hex.EncodeToString([]byte(value))
	}
	for _, target := range []string{"go", "python", "java", "cpp", "rust"} {
		t.Run(target, func(t *testing.T) {
			dir := t.TempDir()
			literal := func(value string) string { return goLiteral(QuotedString(value)) }
			var source, filename string
			var compile, execute []string
			switch target {
			case "go":
				tool := literalTestTool(t, "go")
				filename = "literal.go"
				source = "package main\nimport (\"fmt\"; \"encoding/hex\")\nfunc main(){for _,s:=range []string{VALUES}{fmt.Println(hex.EncodeToString([]byte(s)))}}"
				execute = []string{tool, "run", filepath.Join(dir, filename)}
			case "python":
				tool := literalTestTool(t, "python3")
				literal = func(value string) string { return pythonLiteral(QuotedString(value)) }
				filename = "literal.py"
				source = "for s in [VALUES]:\n    print(s.encode('utf-8').hex())\n"
				execute = []string{tool, filepath.Join(dir, filename)}
			case "java":
				javac, err := findJavaTool("javac")
				if err != nil {
					t.Skip(err)
				}
				java, err := findJavaTool("java")
				if err != nil {
					t.Skip(err)
				}
				literal = javaStringLiteral
				filename = "LiteralRoundTrip.java"
				source = "import java.nio.charset.StandardCharsets;\nclass LiteralRoundTrip{ public static void main(String[] args){ for(String s:new String[]{VALUES}){ for(byte b:s.getBytes(StandardCharsets.UTF_8)) System.out.printf(\"%02x\",b&255); System.out.println(); } } }"
				compile = []string{javac, "-encoding", "UTF-8", filepath.Join(dir, filename)}
				execute = []string{java, "-cp", dir, "LiteralRoundTrip"}
			case "cpp":
				tool := literalTestTool(t, "c++")
				literal = func(value string) string { return cppLiteral(QuotedString(value)) }
				filename = "literal.cpp"
				source = "#include <iostream>\n#include <iomanip>\n#include <string>\n#include <vector>\n#include <utility>\nstruct Value{std::string text;Value(const char*s):text(s){} Value(std::string s):text(std::move(s)){}};\nint main(){ for(auto s:std::vector<Value>{VALUES}){ for(unsigned char b:s.text) std::cout<<std::hex<<std::setw(2)<<std::setfill('0')<<unsigned(b);std::cout<<\"\\n\"; }}"
				compile = []string{tool, "-std=c++17", filepath.Join(dir, filename), "-o", filepath.Join(dir, "literal")}
				execute = []string{filepath.Join(dir, "literal")}
			case "rust":
				tool := literalTestTool(t, "rustc")
				literal = rustStringLiteral
				filename = "literal.rs"
				source = "fn main(){for s in [VALUES]{for b in s.as_bytes(){print!(\"{:02x}\", b);}println!();}}"
				compile = []string{tool, filepath.Join(dir, filename), "-o", filepath.Join(dir, "literal")}
				execute = []string{filepath.Join(dir, "literal")}
			}
			literals := make([]string, len(values))
			for i, value := range values {
				literals[i] = literal(value)
			}
			source = strings.ReplaceAll(source, "VALUES", strings.Join(literals, ","))
			if err := os.WriteFile(filepath.Join(dir, filename), []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			if len(compile) != 0 {
				runLiteralTest(t, compile)
			}
			output := runLiteralTest(t, execute)
			got := strings.Split(strings.TrimSpace(output), "\n")
			if !reflect.DeepEqual(got, want) {
				for i := range want {
					if i >= len(got) || got[i] != want[i] {
						t.Fatalf("value %d (%q) did not preserve its bytes", i, values[i])
					}
				}
				t.Fatalf("got %d results, want %d", len(got), len(want))
			}
		})
	}
}

func literalTestTool(t *testing.T, name string) string {
	t.Helper()
	tool, err := exec.LookPath(name)
	if err != nil {
		t.Skipf("%s unavailable: %v", name, err)
	}
	return tool
}

func runLiteralTest(t *testing.T, command []string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	output, err := exec.CommandContext(ctx, command[0], command[1:]...).CombinedOutput()
	if err != nil {
		t.Fatalf("%s: %v\n%s", command[0], err, output)
	}
	return string(output)
}
