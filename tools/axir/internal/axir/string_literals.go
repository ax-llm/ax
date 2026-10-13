package axir

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

// Target literals must preserve the value, rather than reuse Go escape syntax.
// Java has no hex-byte escapes, Rust uses braced Unicode escapes, and C++ hex
// escapes consume following hex digits. Keep printable UTF-8 text readable.
func javaQuoteString(value string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"', '\\':
			out.WriteByte('\\')
			out.WriteRune(r)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		default:
			if unicode.IsPrint(r) {
				out.WriteRune(r)
			} else if r <= 0xffff {
				fmt.Fprintf(&out, `\u%04x`, r)
			} else {
				high, low := utf16.EncodeRune(r)
				fmt.Fprintf(&out, `\u%04x\u%04x`, high, low)
			}
		}
	}
	out.WriteByte('"')
	return out.String()
}

func rustQuoteString(value string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"', '\\':
			out.WriteByte('\\')
			out.WriteRune(r)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		default:
			if unicode.IsPrint(r) {
				out.WriteRune(r)
			} else {
				fmt.Fprintf(&out, `\u{%x}`, r)
			}
		}
	}
	out.WriteByte('"')
	return out.String()
}

func cppStringLiteral(value string) string {
	var out strings.Builder
	out.WriteByte('"')
	for i := 0; i < len(value); {
		r, size := utf8.DecodeRuneInString(value[i:])
		switch r {
		case '"', '\\':
			out.WriteByte('\\')
			out.WriteRune(r)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		default:
			if unicode.IsPrint(r) && !(r == utf8.RuneError && size == 1) {
				out.WriteString(value[i : i+size])
			} else {
				for _, b := range []byte(value[i : i+size]) {
					fmt.Fprintf(&out, `\%03o`, b)
				}
			}
		}
		i += size
	}
	out.WriteByte('"')
	literal := out.String()
	if strings.ContainsRune(value, 0) {
		// Value(const char*) stops at NUL; select its std::string overload.
		return fmt.Sprintf("std::string(%s, %d)", literal, len(value))
	}
	return literal
}
