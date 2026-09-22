# Helpers shared by the scenarios
LAB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LAB"
export PATH="$LAB/bin:$PATH"
# Repository key of a backend, as stored in .autorestic.env (AUTORESTIC_<BACKEND>_RESTIC_PASSWORD)
key_of() { grep "^AUTORESTIC_$(echo "$1" | tr '[:lower:]' '[:upper:]')_RESTIC_PASSWORD=" .autorestic.env | cut -d= -f2-; }
banner() { echo; echo "=================== SCENARIO: $1 ==================="; echo "$2"; echo; }
