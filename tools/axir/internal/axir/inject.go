package axir

import (
	"fmt"
	"strings"
)

// mustInject replaces marker with body in template, erroring unless the
// marker occurs exactly once. strings.Replace silently no-ops on a missing
// marker, which has already shipped a template without its generated code
// once (the C++ declarations marker landed in one template constant while
// the build replaced it in another); this guard turns that whole failure
// class into a build error.
func mustInject(template, marker, body, name string) (string, error) {
	switch count := strings.Count(template, marker); count {
	case 1:
		return strings.Replace(template, marker, body, 1), nil
	case 0:
		return "", fmt.Errorf("template %s is missing marker %q", name, strings.TrimSpace(marker))
	default:
		return "", fmt.Errorf("template %s contains marker %q %d times, want exactly one", name, strings.TrimSpace(marker), count)
	}
}
