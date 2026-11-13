# joons-mcp-tool-catalog

하나 이상의 MCP 도구 목록 스냅숏(`joons-mcp-diff/snapshot` v1 형식)을 하나로
병합하여, 정규화하고 검색할 수 있는 오프라인 도구 카탈로그를 만들어 주는
명령줄 도구입니다.

이 도구는 완전히 오프라인으로 동작합니다. 어떤 MCP 서버에도 연결하지 않고,
어떤 도구도 실행하지 않으며, 네트워크 요청을 별내지 않고, 새 프로세스를
띄우지도 않습니다. 어떤 MCP 서버도 접촉하지 않았다는 뜻입니다.

## 주요 기능

- 서버 여러 대의 스냅숏을 하나의 카탈로그로 병합합니다.
- 서버 간에 이름이 겹치는 도구를 찾아 냅니다. 완전히 같은 이름(정확한
  충돌)과, 대소문자나 앞뒤 공백만 다른 이름(약한 충돌) 두 가지를
  구분합니다.
- 서버별 도구 목록과 전체 목록을 보여 줍니다.
- 도구 이름, 제목, 설명을 대상으로 한 결정적(deterministic) 텍스트
  검색을 제공합니다.
- `catalog.json` 파일과 마크다운 보고서, 터미널 보고서를 만들어 냅니다.

## 요구 사항

Node.js 20 이상. 의존성이 전혀 없고 빌드 단계도 없습니다. 설치할 것이
없습니다.

## 빠른 시작

```sh
# 스냅숏 파일이 올바른지 검사합니다. 문제가 없으면 0을 반환합니다.
node bin/joons-mcp-tool-catalog.js validate examples/sample-snapshot.json

# ./out 디렉터리에 카탈로그를 만듭니다.
node bin/joons-mcp-tool-catalog.js build examples/sample-snapshot.json --out out

# 스냅숏들을 대상으로 검색합니다.
node bin/joons-mcp-tool-catalog.js search examples/sample-snapshot.json --query weather

# 서버별 도구 수를 봅니다.
node bin/joons-mcp-tool-catalog.js list examples/sample-snapshot.json

# 충돌하는 이름을 봅니다. 충돌은 오류가 아니라 데이터이므로 0을 반환합니다.
node bin/joons-mcp-tool-catalog.js collisions examples/sample-snapshot.json
```

## 명령줄 사용법

```
joons-mcp-tool-catalog build <snapshot>... --out DIR [--force] [--format terminal|json|markdown] [--quiet]
joons-mcp-tool-catalog search <snapshot>... --query TEXT [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog list <snapshot>... [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog collisions <snapshot>... [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog validate <snapshot>... [--quiet]
joons-mcp-tool-catalog --help | --version
```

- `<snapshot>...`: 스냅숏 파일을 하나 이상 줍니다. 디렉터리는 거부됩니다.
  옵션은 `--key=value` 형식과 `--key value` 형식을 모두 받습니다. `--`는 사용법 오류입니다.
- `--out DIR`(build 전용, 필수): 결과를 쓸 디렉터리입니다. 입력 파일을
  담고 있거나 입력 파일 안에 들어 있는 디렉터리는 거부됩니다. 이미 내용이
  있는 디렉터리는, 이전 실행이 남긴 `.joons-mcp-tool-catalog-output`
  표시 파일이 있거나 `--force`를 준 경우에만 사용할 수 있습니다.
  `--force`는 경로와 심볼릭 링크 검사를 우회하지 않고, 어떤 파일도
  지우지 않습니다.
- `--query TEXT`(search 전용, 필수): 검색어입니다. 앞뒤 공백을 뺀 길이가
  1에서 200 사이여야 합니다. 검색은 공백으로 나눈 단어들을 모두 포함하는
  도구를 찾는 방식입니다. 대소문자를 구분하지 않으며, 도구 이름과 제목,
  설명을 대상으로 합니다. 점수는 이름에 있으면 100점, 제목에 있으면
  10점, 설명에 있으면 1점으로 계산하고, 점수가 같으면 이름 순, 서버
  번호 순, 도구 번호 순으로 정합니다. 화면에는 최대 1,000개까지 보여
  주고, 전체 일치 개수는 `counts.matches`에 실제 값으로 적힙니다.
- `--format`: `terminal`(기본값), `json`, `markdown` 중 하나입니다.
- `--quiet`(build, validate 전용): 성공한 터미널 보고서는 출력하지 않습니다.
  JSON이나 마크다운 보고서와 오류 메시지는 그대로
  나옵니다.
- `--details`(search, list, collisions 전용): 보고서에 입력에서 온
  이름을 짧게 가린 형태로 추가합니다. 내부의 이름이 들어갈 수 있으니
  공유하기 전에 반드시 확인하세요.
- `--force`(build 전용): 위 `--out` 설명을 참고하세요.

성공하면 보고서 하나를 표준 출력에 쓰며, `--quiet`의 터미널 성공 시에는 출력하지 않습니다.
문제가 있으면 표준 오류에
`joons-mcp-tool-catalog: <kind>` 형식의 고정된 줄을 하나만 출력합니다.

종료 코드: `0`은 성공입니다. 충돌이 있어도 성공입니다. `2`는 입력을 읽을
수 없거나, 형식이 맞지 않거나, 안전하지 않거나, 한도를 넘은 경우이며,
예상 못한 내부의 오류도 `internal_error`라는 고정된 메시지로 이 코드를
사용합니다. `3`은 사용법 오류입니다. `4`는 출력 디렉터리 준비나 파일
쓰기, 표준 출력 쓰기가 실패한 경우입니다. 종료 코드 1은 존재하지 않습니다.

자세한 문법, 모든 고정 오류 메시지, 보고서의 모든 필드는
[docs/CLI.md](docs/CLI.md)에 적혀 있습니다.

## 출력 파일과 형식

`build --out DIR`은 다음 세 파일을 이 순서대로 씁니다.

1. `catalog.json`: 정규화된 카탈로그입니다. 서버는 `server-1`,
   `server-2` 같은 번호로만 나타나고, 각 서버 스냅숏 원본 바이트의
   SHA-256 해시 앞 12글자로 구분됩니다. `catalog.json`에는 도구 이름이
   원문 그대로 들어가고, 제목과 설명은 가리기 처리를 거쳐 들어갑니다.
   파일 쓰기는 `--out`을 준 것 자체가 명시적인 동의이기 때문입니다. 다만
   가리기는 일정한 패턴에 대한 최선의 노력입니다. 바뀐 횟수는
   `counts.redactions`에 기록됩니다.
2. `catalog.md`: 번호와 개수만 요약하며 이름, 제목, 설명은 포함하지 않습니다.
3. `.joons-mcp-tool-catalog-output`: 내용이 0바이트인 표시 파일입니다.
   항상 마지막에 쓰입니다.

화면에 나오는 보고서는 `joons-mcp-tool-catalog/report` 형식을 쓰고,
기본 보고서는 고정된 안전한 어휘와 번호만 사용합니다. `--details`를
준 경우에는 입력에서 온 짧고 가려진 이름이 추가됩니다.

## 충돌을 어떻게 읽어야 하나

충돌과 중복은 오류가 아니라 카탈로그 데이터입니다. 성공적인 명령은
언제나 0으로 끝납니다.

- 정확한 충돌: 여러 서버가 문자열이 완전히 같은 도구 이름을 제공하는
  경우입니다.
- 약한 충돌: `Get_Weather`와 `get_weather `처럼 대소문자만 다르거나
  앞뒤 공백만 다른 서로 다른 이름들이 여러 서버에 걸쳐 있는 경우입니다.
  완전히 같은 이름끼리만 모인 무리는 정확한 충돌로 한 번만 보고되고
  약한 충돌로는 다시 보고되지 않습니다.

충돌이 있다는 것은 이름이 같거나 겹친다는 뜻이지, 도구가 같은 동작을
한다는 뜻이 아닙니다. 카탈로그는 어디를 살펴야 할지 알려 주는 지도일 뿐,
도구 자체를 대신 검토해 주지는 않습니다.

## 안전한 공유

- 보고서는 고정된 어휘만으로 만들어집니다. `--details`는 짧고 가려진
  이름만 추가할 뿐, 입력 문장을 그대로 늘리지 않습니다.
- 입력 파일은 신뢰하지 않는 데이터로 취급합니다. 크기와 깊이에 한도를
  두고, 위험한 키 이름과 비밀번호나 토큰처럼 생긴 식별자를 검사하며,
  실행하거나, 다른 경로나 주소로 열거나, 정규 표현식으로 만들어 쓰는 일이
  없습니다. 서버 이름이나 도구 이름에 비밀 값 형태가 보이면 해당
  스냅숎 하나를 통째로 거부합니다.
- 가리기(redaction)는 최선의 노력이며 완전한 익명화를 보장하지 않습니다.
  `catalog.json`에는 정확한 도구 이름과 가리기 처리된 제목, 설명이 들어가며
  `catalog.md`는 번호와 개수를 요약합니다. URL, 실제 Windows 드라이브·UNC·POSIX·`~/` 경로
  시작점부터 필드 끝까지, 이메일, IPv4, Bearer/JWT, 민감한 이름=값과
  토큰을 패턴으로 찾고, 자격증명에는 관대한 percent 디코딩과 base64
  후보도 검사합니다. percent 인코딩 등으로 감춘 경로 시작점, 원문 도구
  이름 속 이름이나 경로, hex·base32·역순·엔터티 인코딩, 자유 문장의
  사람 이름은 인식하지 못합니다. 공유하기 전에 사람이 출력을 확인해야 합니다.

## 결정성

같은 입력 바이트와 같은 옵션이면 실행을 몇 번이고 반복해도, 입력
순서를 바꿔도, 다른 운영체제에서 실행해도 결과 바이트가 완전히
같습니다. 시각이나 난수, 지역별 정렬, 입력 파일 위치를 메타데이터로
사용하지 않기 때문입니다. 모든 출력은 LF 줄 바꿈을 쓰는 UTF-8입니다.

## 개발과 테스트

```sh
node scripts/test.js
```

테스트 실행기는 검사할 테스트 파일을 명시적으로 목록으로 정해 두고,
Node.js에 내장된 테스트 실행기로 돌립니다. 의존성이 없어서 설치할
것도, 네트워크가 필요한 것도 없습니다.

## 라이선스

Apache-2.0입니다. [LICENSE](LICENSE) 파일을 참고하세요.
# 지원 범위

0.1.1은 명령줄 도구이며 지원하는 라이브러리가 아닙니다. `src/` 모듈은 내부 구현이며 API 안정성을 제공하지 않습니다. 프로세스 내부 사용이나 신뢰할 수 없는 프로세스 내부 객체에 대한 안전성도 보장하지 않습니다. 스냅숏 파일을 명령줄 도구에 전달하세요.

