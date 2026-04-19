# Obsidian WeekFlow - Plugin Specification

## Overview

**Name:** WeekFlow
**Type:** Obsidian Plugin
**Purpose:** 주간 타임테이블 기반의 시간 관리 및 회고 플러그인. 데일리 노트에 기록된 계획(Plan)과 실행(Actual) 데이터를 주간 타임테이블로 집계하여 시각적으로 비교할 수 있다.

## Core Concept

### Plan → Actual → Review 사이클

```
Plan (계획)  ──▶  Actual (실행)  ──▶  Review (회고)
    ▲                                      │
    └──────────── 다음 주 계획에 반영 ───────┘
```

주간 단위로 계획-실행-회고를 반복하며 개선해나가는 것이 핵심 목적이다.

### 시각적 표현

실제 종이 노트에서 볼펜(테두리)으로 계획을 표시하고, 형광펜(채우기)으로 실행을 기록하는 방식을 디지털로 옮긴다.

- **계획(Plan):** 셀 테두리(outline)로 표현 — `- [ ]`
- **실행(Actual):** 셀 채우기(fill)로 표현 — `- [x]`
- **회고(Review):** 타임테이블 하단 패널에 자유 텍스트

## Timetable Structure

### Grid Layout

```
         Mon       Tue       Wed       Thu       Fri       Sat       Sun
        ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐
(start) │ 10m │×6 │     │   │     │   │     │   │     │   │     │   │     │
        ├─────┤   ├─────┤   ├─────┤   ├─────┤   ├─────┤   ├─────┤   ├─────┤
  +1h   │     │   │     │   │     │   │     │   │     │   │     │   │     │
        ├─────┤   ├─────┤   ├─────┤   ├─────┤   ├─────┤   ├─────┤   ├─────┤
  ...   │     │   │     │   │     │   │     │   │     │   │     │   │     │
        └─────┘   └─────┘   └─────┘   └─────┘   └─────┘   └─────┘   └─────┘
```

- **Columns:** 7일 (시작 요일은 설정의 Week Start Day)
- **Rows:** 1시간 단위 (설정의 Day Start Hour ~ Day End Hour)
- **Sub-columns:** 각 시간당 6칸 (10분 단위, 고정)
- **셀 하나 = 특정 요일의 특정 10분 슬롯**
- **1분 단위 렌더링:** 기본 입력 단위는 10분(그리드 셀)이지만, 데일리 노트에 1분 단위 시간이 기록되어 있으면 정확한 위치에 렌더링한다 (e.g., `09:03-10:47`). 10분 셀 경계에 맞지 않는 시작/끝 시간은 비례 오프셋(`left`/`right`)으로 블록을 정확한 분 위치에 배치하며, 블록은 깔끔한 직사각형을 유지한다.

### Grid Visual Hierarchy

- **랜드마크 시간 (0, 6, 12, 18시):** 시간 레이블이 굵게 표시되어 시간대 파악이 용이
- **짝수 시간 배경:** 짝수 시간 행에 미세한 배경색 밴드를 적용하여 시각적 리듬 제공
- **주말 구분:** 토/일 헤더와 셀에 별도의 배경색 적용, 평일과 시각적으로 구분
- **헤더 요약 통계:** 각 날짜 헤더에 `done/total` 비율 표시 (e.g., `3/5`)
- **현재 시간 인디케이터:** 테마 accent 색상 사용 (`var(--interactive-accent)`), 도트에 펄스 애니메이션 적용
- **블록 적응형 표시:** 30분 미만 짧은 블록에서는 시간 레이블을 숨겨 콘텐츠 가독성 확보
- **빈 날짜 힌트:** 블록이 없는 날 컬럼에 "Drag to add" 텍스트 표시

### Cell States

각 셀은 체크박스 상태와 시간 표기 형식의 조합으로 결정된다.

| 상태 | 마크다운 형식 | 시각적 표현 | 설명 |
|------|-------------|------------|------|
| Empty | — | 빈 셀 | 아무 할당 없음 |
| Plan only | `- [ ] 09:00-11:00 내용 #tag` | 테두리(outline) + 미세 채우기(6%) | 계획만 있음 (미실행) |
| Plan = Actual | `- [x] 09:00-11:00 내용 #tag` | 채우기(fill) | 계획대로 실행됨 |
| Plan ≠ Actual | `- [x] 09:00-11:00 > 09:00-10:30 내용 #tag` | 채우기(fill) + 테두리(outline) | 계획과 실행 시간이 다름 |
| Deferred | `- [>] 09:00-11:00 내용 #tag` | 파선 테두리(dashed) + 반투명(45%) + grayscale(25%) | 다른 날로 미룸 |

## Interaction

### 시간 블록 할당

**데스크톱 (마우스):**
1. **클릭:** 단일 셀 선택 → 인라인 에디터
2. **드래그:** 연속된 셀 범위 선택 (같은 날 내) → 인라인 에디터
3. **인라인 에디터 (생성):** 빈 셀 선택 영역 위에 플로팅 입력 필드가 표시된다. 툴바에서 선택된 카테고리가 기본 적용되며, 카테고리 도트 클릭으로 드롭다운 변경 가능. `Enter`로 즉시 블록 생성, `Tab`으로 풀 모달(`BlockModal`) 전환 (시간 수정 등 상세 편집), `Esc`로 취소.
   - **`#tag` 자동완성:** 입력 중 `#`을 타이핑하면 카테고리 목록이 드롭다운으로 표시된다. `#` 뒤 텍스트로 `tag`/`label` 기준 필터링되며, `↑`/`↓` 키로 항목 탐색, `Enter`로 선택. 선택 시 `#query` 텍스트는 입력에서 제거되고 카테고리만 반영.
   - **`>inbox` 픽업:** 입력 중 `>`를 타이핑하면 인박스 아이템 목록이 드롭다운으로 표시된다. `>` 뒤 텍스트로 `content`/`tag` 기준 필터링되며, `↑`/`↓` 탐색, `Enter` 선택. 선택 시 **인박스에서 아이템 제거 + 현재 시간대에 블록 생성** (드래그드롭과 동일 이동 동작, undo 가능).
3a. **인라인 에디터 (편집):** vim `i`/`Enter`로 블록 위에서 진입 시, 블록 위치에 인라인 에디터가 열리며 기존 content/tag가 프리필된다. `Enter`로 content·tag만 저장 (시간은 유지), `Tab`으로 인라인 변경 저장 후 `EditBlockModal` 승격 (시간·actual 등 상세 편집), `Esc`로 취소. `>inbox` 프리픽스는 편집 모드에서 비활성.
   - **Escape 포커스 보존:** 인라인 에디터에서 `Esc` 처리 시 뷰 scope에 등록된 전용 Escape 핸들러가 Obsidian `app.scope`의 기본 동작(이전 노트로 포커스 복원)을 차단. input 제거 전에 grid-wrapper로 포커스를 먼저 옮겨 workspace가 포커스 소실로 판단하지 않도록 한다.
4. 날짜에 따라 Plan/Actual 자동 결정 (오늘/미래 → Plan, 과거 → Actual)

**터치 (모바일/태블릿) — 탭-탭 방식:**
1. **첫 번째 탭:** 시작 셀 앵커 설정 (하이라이트)
2. **두 번째 탭 (같은 요일):** 범위 확장 → 모달 열기
3. **같은 셀 재탭:** 단일 셀 블록 생성
4. **다른 요일 탭:** 기존 선택 취소 → 새 앵커 설정
5. **드래그:** 세로=스크롤, 가로=스와이프 (셀 선택과 분리)

### 통합 뷰 (Unified View)

Plan과 Actual 블록을 하나의 뷰에서 동시에 표시한다. 별도의 모드 전환 없이 날짜에 따라 자동으로 결정된다.

- **오늘/미래 날짜에 블록 생성:** `- [ ]` (Plan)으로 기록 → 테두리로 표시
- **과거 날짜에 블록 생성:** `- [x]` (Actual)로 기록 → 채우기로 표시
- **블록 완료 토글:** Plan 블록에 표시되는 ○ 버튼을 클릭하면 `- [x]` (Actual)로 변환. Actual 블록의 ✓ 버튼을 클릭하면 `- [ ]` (Plan)으로 되돌림. 토글 버튼은 블록의 마지막 세그먼트(여러 행에 걸치는 경우 마지막 행) 우측 상단에 표시된다. 완료 전환 시 짧은 brightness flash 애니메이션으로 시각적 피드백 제공.
- **Actual 시간 편집:** Actual 블록 클릭 시 편집 모달에서 계획 시간은 읽기 전용으로 표시되고, 실행 시간(Actual time)을 별도로 편집할 수 있다. 실행 시간이 계획 시간과 다르면 `> HH:MM-HH:MM` 형식으로 저장.

### 블록 편집

- 기존 블록 클릭 시 내용/카테고리/시간 변경 또는 삭제 가능
  - Plan 블록: 계획 시간, 내용, 카테고리 편집
  - Actual 블록: 계획 시간은 읽기 전용, 실행 시간(Actual time)과 내용/카테고리 편집
  - EditBlockModal 내 완료 토글: Plan 블록에 "Mark as Done" 버튼, Actual 블록에 "Mark as Incomplete" 버튼 표시. Deferred 블록에는 미표시. 클릭 시 모달 닫힘 + 상태 전환.
- 블록 우클릭 시 컨텍스트 메뉴 표시 (Obsidian 네이티브 `Menu` 사용):
  - **Edit** — EditBlockModal 열기
  - **Mark as Done** (Plan) / **Mark as Incomplete** (Actual) — 완료 상태 토글. Deferred 블록에는 미표시.
  - **Go to daily note** — 데일리 노트의 해당 라인으로 이동 (`arrow-up-right` 아이콘)
  - **Return to inbox** — 블록을 인박스로 되돌리기. 실행 후 5초간 Undo 토스트(클릭 가능 링크) 표시. 모바일 터치 환경에서는 액션 바 "더보기(⋯)" 메뉴를 통해 접근
  - **Delete** — 블록 삭제. 실행 후 5초간 Undo 토스트(클릭 가능 링크) 표시
- 블록 경계를 드래그하여 시간 범위 조정 (리사이즈)
  - Actual 블록 리사이즈 시 actualTime만 변경, planTime은 보존
- 블록을 드래그하여 다른 시간대/요일로 이동 (같은 주 내)
  - 다른 요일로 이동 시 해당 날짜의 데일리 노트로 데이터가 옮겨짐
  - Actual 블록 이동 시 actualTime만 변경, planTime은 보존

### 터치 블록 인터랙션

모바일/태블릿 터치 환경에서 블록은 **3단계 모드**로 동작한다. 롱프레스를 사용하지 않고, 모든 동작을 명시적 버튼 탭으로 수행하여 스크롤과 드래그의 충돌을 완전히 제거한다.

```
[일반 모드] ─탭→ [선택 모드] ─이동 버튼→ [이동 모드] ─확인/취소→ [선택 모드]
                              ─삭제 버튼→ [삭제 확인] ─확인/취소→ [선택 모드]
                              ─다른 곳 탭→ [일반 모드]
```

#### 일반 모드

- 터치 = 스크롤만. `preventDefault()` 미호출
- 블록 탭 → 선택 모드 진입
- Apple Pencil은 마우스와 동일하게 동작: 블록 150ms 홀드 후 직접 드래그, 리사이즈 핸들 직접 드래그, 호버 시 툴팁만 표시. 탭 시 선택 모드(액션 바) 진입

#### 선택 모드

블록 하단에 액션 바가 표시된다:

```
┌─────────────────────────┐
│  09:00 Meeting #work    │
└─────────────────────────┘
  [✏️] [↔️] [🗑️] [↗️] [⋯]
  편집  이동  삭제  노트  더보기
```

| 버튼 | 동작 |
|------|------|
| 편집 | EditBlockModal 열기 |
| 이동 | 이동 모드 진입 |
| 삭제 | 삭제 확인 모드 진입 |
| 노트 | 데일리 노트의 해당 라인으로 이동 |
| 더보기 | Obsidian `Menu` 표시 (완료 토글 등) |

- 다른 곳 탭 → 선택 해제 (일반 모드 복귀)
- 다른 블록 탭 → 선택 전환
- Apple Pencil 탭으로 진입한 선택: 터치 탭과 동일하게 동작 (다른 곳 탭 시 해제)

#### 이동 모드

이동 버튼 탭 시 진입. 블록/고스트를 드래그하여 시간/요일을 변경하거나, 상하 가장자리를 드래그하여 리사이즈할 수 있다. 확인 전까지 여러 번 드래그/리사이즈를 반복할 수 있다.

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
╎  09:00 Meeting #work    ╎  ← 시각적 구분 (점선 등)
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
       [✓ 확인] [✕ 취소]
```

- 블록/고스트 터치+이동 → 드래그 (시간/요일 변경). 이때만 `preventDefault()` + `touch-action: none`. 빈 셀 터치로는 드래그 시작 불가 (스크롤 유지)
- 드래그 완료 시 고스트 블록이 새 위치에 표시되며, 상하에 리사이즈 핸들이 자동 추가됨
- 고스트의 리사이즈 핸들 터치+이동 → 리사이즈. `setPointerCapture()`로 핸들 밖 드래그에도 이벤트 유지
- 드래그/리사이즈를 여러 번 반복 가능 — 누적 위치(`currentStart/currentEnd/currentDayIndex`)가 매 조작마다 갱신됨
- Apple Pencil은 마우스와 동일하게 직접 드래그(150ms 홀드)/리사이즈 가능 (이동 모드 불필요). 탭 시에는 터치와 동일하게 액션 바 표시
- **확인** 탭 → 변경 적용, 선택 모드로 복귀
- **취소** 탭 → 변경 취소 (누적 위치를 원래 값으로 리셋, 고스트 제거), 선택 모드로 복귀

#### 삭제 확인

삭제 버튼 탭 시 진입. 액션 바가 확인/취소로 전환된다.

```
       [🗑️ 확인] [✕ 취소]
```

- **확인** 탭 → 블록 삭제, 일반 모드로 복귀
- **취소** 탭 → 선택 모드로 복귀

### 터치 패널 아이템 인터랙션

패널 아이템도 블록과 동일한 선택 패턴을 적용한다. 선택 전까지 `preventDefault()` 미호출로 패널 스크롤이 가능하다.

- **데스크톱 hover (`@media (pointer: fine)`):** 아이템 hover 시 우측에 `arrow-up-right` nav 아이콘 표시 (인박스/오버듀만). 클릭 시 소스 노트/데일리 노트로 이동
- **터치/펜 탭 → 선택:** 아이템 하단에 플로팅 액션 바 표시 (`document.body`에 `position: fixed`로 마운트, 그리드 블록 액션 바와 동일 패턴). 선택 시 hover nav 아이콘은 숨김
- **액션 바 구성:** [↔ Move (드래그 핸들)] [↗ Navigate (인박스/오버듀만)] [✏ Edit (인박스만)] [🗑 Delete (인박스만)]
- **선택 해제:** 그리드/다른 곳 탭(`deselectAll()`), 패널 스크롤 시 자동 해제 (scroll listener)
- 터치/펜 환경에서 `contextmenu` 이벤트 무시 (`lastPointerType === "touch" || "pen"` 가드) — 롱프레스 시 불필요한 컨텍스트 메뉴 방지

### 타임 슬롯 프리셋

반복되는 시간 구조를 프리셋으로 정의하여 빈 테이블에 빠르게 적용할 수 있다.

```
프리셋 예시: "평일 루틴"
┌──────────────────────────┐
│ 06:00-07:00  아침 루틴    │
│ 09:00-12:00  오전 업무    │
│ 12:00-13:00  점심         │
│ 13:00-18:00  오후 업무    │
│ 22:00-23:00  저녁 루틴    │
└──────────────────────────┘
```

- 프리셋 데이터는 플러그인 설정에 저장 (설정 화면에서 삭제 가능)
- 툴바의 프리셋 버튼(🕐)을 클릭하면 드롭다운 메뉴 표시:
  - **"Save current day as preset..."**: 오늘 날짜의 Plan 블록으로 새 프리셋 생성
  - **저장된 프리셋 목록**: 클릭 시 적용 모달 열기
- **프리셋 적용 모달**: 적용할 요일 선택(7개 체크박스) + "기존 Plan 블록 덮어쓰기" 옵션
- 적용 시 선택된 요일에 Plan 블록 일괄 생성
- Undo로 적용 전 상태 복원 가능

## Categories (Settings)

카테고리는 옵시디언 태그(`#tag`)로 표현된다. 설정에서 태그별 색상을 매핑한다.

```typescript
interface Category {
  tag: string;       // 옵시디언 태그 (e.g., "work", "study") — '#' 제외
  label: string;     // 표시 이름 (e.g., "업무", "학업")
  color: string;     // HEX 색상 코드 (e.g., "#4A90D9")
}
```

- 데일리 노트에 기록된 태그가 설정에 없으면 기본 색상(회색)으로 표시한다
- 하나의 항목에 태그가 여러 개이면 첫 번째 태그의 색상을 사용한다

### 기본 제공 카테고리

| Tag | Label | Color |
|-----|-------|-------|
| `#work` | Work | `#4A90D9` (파랑) |
| `#personal` | Personal | `#BD10E0` (보라) |

## Data Storage

### Architecture: 데일리 노트 기반

데이터의 원본(source of truth)은 **데일리 노트**이다. 위클리 타임테이블은 해당 주의 7개 데일리 노트를 읽어서 집계하는 **뷰(view)** 역할만 한다.

```
Daily Note (Mon) ──┐
Daily Note (Tue) ──┤
Daily Note (Wed) ──┤
Daily Note (Thu) ──┼──▶ Weekly Timetable View (집계/렌더링)
Daily Note (Fri) ──┤
Daily Note (Sat) ──┤
Daily Note (Sun) ──┘
```

- 타임테이블에서 셀을 편집하면 → 해당 날짜의 **데일리 노트에 데이터가 저장**된다
- 위클리 뷰는 데일리 노트를 읽기만 할 뿐, 별도의 주간 데이터 파일을 생성하지 않는다
- 데일리 노트가 아직 없는 날에 셀을 할당하면 → 데일리 노트를 자동 생성한다
  - **템플릿 지원:** 설정에 템플릿 파일 경로가 지정되어 있으면, 새 데일리 노트 생성 시 해당 템플릿의 내용을 그대로 복사하여 기반으로 생성한다. 토큰 치환은 하지 않으며, Templater 등 사용자의 템플릿 플러그인이 별도로 처리한다.
  - 템플릿에 Timeline Heading이 이미 포함되어 있으면 그 아래에 항목을 삽입하고, 없으면 끝에 추가

### 주간 노트

주간 노트는 데일리 노트와 별도의 파일로, 주 단위 리뷰를 저장한다. 경로 패턴은 moment.js 토큰을 사용하며 (기본: `YYYY-[W]ww`), 같은 주 내 어떤 날짜를 전달하더라도 동일한 파일로 해석된다.

- Review Heading은 데일리 노트와 공용 (`## Review`)
- 주간 노트가 없는 상태에서 리뷰를 저장하면 파일을 자동 생성한다
- 템플릿 지원: 데일리 노트와 동일한 방식 (Weekly Note Template 설정)
- `ww` 토큰은 locale 기반 주 번호, `WW` 토큰은 ISO 기반 (월요일 시작)

### 데일리 노트 내 데이터 형식

데일리 노트 내 **특정 헤딩(heading)** 아래에 마크다운 리스트로 저장한다. 헤딩 이름은 설정에서 지정할 수 있다.

```markdown
# My Daily Note

오늘의 일기...

## Timeline
- [ ] 09:00-11:00 프로젝트 A 설계 문서 작성 #work 📅 2026-02-04 ⏫
- [x] 13:00-14:00 알고리즘 문제풀이 #study ✅ 2026-02-04
- [x] 15:00-17:00 > 15:00-16:30 TypeScript 강의 수강 #study ✅ 2026-02-04
- [ ] 20:00-21:00 운동 #exercise 🔁 every day
```

#### 리스트 항목 형식

```
- [ ] HH:MM-HH:MM 내용 #카테고리 [Tasks 메타데이터...]
- [x] HH:MM-HH:MM 내용 #카테고리 [Tasks 메타데이터...]
- [x] HH:MM-HH:MM > HH:MM-HH:MM 내용 #카테고리 [Tasks 메타데이터...]
      (계획 시간)    (실행 시간)
- [>] HH:MM-HH:MM 내용 #카테고리 [Tasks 메타데이터...]
```

**기본 필드:**
- `- [ ]` / `- [x]` / `- [>]` — 체크박스. 미체크=계획, 체크=실행 완료, `>`=다른 날로 미룸
- `HH:MM-HH:MM` — 시작 시간과 종료 시간 (5분 단위)
- `> HH:MM-HH:MM` — (선택) 계획과 실행 시간이 다를 때 실행 시간
- `내용` — 할 일 또는 한 일에 대한 자유 텍스트
- `#카테고리` — 옵시디언 태그 형식의 카테고리 (복수 태그 가능)

**Tasks 플러그인 메타데이터 (선택):**
- `📅 YYYY-MM-DD` — 마감일 (due date)
- `⏳ YYYY-MM-DD` — 예정일 (scheduled date)
- `🛫 YYYY-MM-DD` — 시작일 (start date)
- `✅ YYYY-MM-DD` — 완료일 (done date, 체크 시 자동 추가)
- `⏫` / `🔼` / `🔽` — 우선순위 (high / medium / low)
- `🔁 every day/week/month` — 반복 주기

WeekFlow는 시간 범위(`HH:MM-HH:MM`)와 `>` 구분자를 자체 파싱하고, 나머지 Tasks 메타데이터는 그대로 보존한다. 이를 통해 Tasks 플러그인 쿼리와 완전히 호환된다.

#### 자정을 넘기는 항목 (Overnight)

자정 기준으로 분리하여 각 날짜의 데일리 노트에 저장한다.

예: 23:00-07:00 수면 → 타임테이블에서 드래그로 입력 시 자동 분리:

```markdown
<!-- 2026-02-06 (금) 데일리 노트 -->
## Timeline
- [x] 23:00-00:00 수면 #rest

<!-- 2026-02-07 (토) 데일리 노트 -->
## Timeline
- [x] 00:00-07:00 수면 #rest
```

- WeekFlow 뷰에서는 연속된 블록으로 시각적으로 이어서 렌더링한다
- 사용자가 수동으로 데일리 노트에 기록할 때도 자정 기준으로 나누어 기록한다

#### 파싱 규칙

1. 설정의 Timeline Heading에 지정된 헤딩을 찾는다
2. 해당 헤딩 아래의 체크박스 리스트 항목을 다음 헤딩 또는 파일 끝까지 파싱한다
3. 체크박스 상태로 Plan(`- [ ]`) / Actual(`- [x]`) / Deferred(`- [>]`)를 구분한다
4. `>` 구분자가 있으면 앞쪽을 계획 시간, 뒤쪽을 실행 시간으로 파싱한다
5. 헤딩이 없으면 데이터가 없는 것으로 처리한다
6. 종료 시간이 시작 시간보다 이른 항목(e.g., `23:00-02:00`)은 파싱 에러로 무시한다 (자정 분리가 올바른 형식)

#### 로그 (Logs)

타임라인과 별개로, 하루 중 발생한 일을 시간만 붙여 append-only 방식으로 기록하는 **로그** 섹션을 지원한다. 타임라인이 "시간 블록 단위 계획/실행"이라면, 로그는 "지금 일어난 일을 빠르게 남기는 타임스탬프 메모"에 해당한다.

```markdown
## Logs
- 09:12 스탠드업 미팅 참석
- 11:40 PR #184 리뷰 완료
- 14:05 디자인 피드백 정리 #design
```

**형식:**

```
- <timestamp> 내용
```

- `<timestamp>` 형식은 설정의 **Log timestamp format** (moment.js 포맷 문자열)을 따른다. 기본값은 `HH:mm`. `HH:mm:ss`, `h:mm a` 등 임의의 moment.js 포맷 사용 가능
- 헤딩 이름은 설정의 **Logs heading**으로 지정 (기본값 `## Logs`)
- 항목은 시간순으로 저장되며, 태그·위키링크·이모지 등 `<timestamp>` 뒤 내용은 그대로 보존된다
- 시간 저장 granularity는 분 단위. 초가 포함된 포맷을 쓰면 저장 시 분까지만 유지된다

**파싱 규칙:**

1. 설정의 Logs Heading 아래 리스트 항목을 다음 헤딩 또는 파일 끝까지 순회
2. 각 라인에 대해 설정된 timestamp 포맷으로 선두 1~3개 토큰을 strict 파싱 시도 (`h:mm a`, `HH:mm:ss a` 같은 다중 토큰 포맷 지원)
3. 실패 시 관대한 fallback 정규식(`\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?`)으로 재시도 — **포맷 설정이 바뀌어도 이전에 기록된 항목이 유실되지 않도록** 하기 위함
4. 둘 다 실패하는 라인(시간 없는 bullet, 빈 줄, 하위 bullet 등)은 로그 항목이 아닌 것으로 간주하고 **쓰기 시에도 그대로 보존**한다
5. 헤딩이 없으면 데이터가 없는 것으로 처리한다

**쓰기 규칙:**

- 기존에 파싱된 로그 라인은 현재 설정된 포맷으로 재직렬화된다 (round-trip)
- 타임스탬프가 없는 하드코딩된 라인/빈 줄/하위 bullet은 순서와 내용이 그대로 유지된다
- 새 항목 추가 시 전체 로그를 `timeMinutes` 오름차순으로 정렬한 뒤 저장한다 (과거 시각 로그도 올바른 위치에 삽입)
- 헤딩이 없는 경우 파일 끝에 `## Logs` 헤딩을 새로 생성하고 항목을 삽입한다

### 데이터 읽기/쓰기 흐름

1. **읽기:** 주간 뷰 열기 시 → 해당 주의 데일리 노트 7개를 찾아서 지정된 헤딩 아래 리스트를 파싱
2. **쓰기:** 타임테이블에서 셀 편집 시 → 해당 날짜의 데일리 노트에서 해당 헤딩 섹션을 찾아 리스트를 업데이트 (헤딩이 없으면 노트 끝에 추가)
3. **동기화:**
   - **능동 편집 중(active editing):** WeekFlow 뷰에서 셀을 편집하면 데일리 노트에 즉시 반영하고, 데일리 노트에서 해당 헤딩 섹션을 수정하면 WeekFlow 뷰에 즉시 반영한다 (양방향 실시간).
   - **비활성 상태에서 복귀:** 다른 노트를 보다가 WeekFlow 뷰 또는 데일리 노트로 돌아올 때 데이터를 다시 읽는다.
   - **외부 변경(다른 노트 편집 등):** 관련 없는 파일 변경은 감시하지 않는다.

## Project Integration

### 프로젝트 태스크와의 연결

설정에 지정된 태그와 상태 필드를 기반으로 활성 프로젝트를 식별하고, 해당 프로젝트의 태스크 헤딩에서 미완료 태스크를 읽어온다.

#### Planning Panel

WeekFlow 뷰 사이드에 플래닝 패널을 제공한다. 시간 배정이 필요한 항목들을 모아 보여준다.

```
┌─ Planning ───────────────────────────────┐
│                                           │
│ ⚠️ 미완료 (Overdue)                       │
│  ☐ 02/03 09:00-11:00 API 설계 #work      │
│  ☐ 02/04 14:00-16:00 문서 작성 #work      │
│                                           │
│ 📋 인박스 (설정된 소스)                     │
│  [+ 새 항목 추가...]                       │
│  ☐ 코드 리뷰                             │
│                                           │
│ 📁 중기부 RnD 사업 지원서 작성 지원         │
│  ☐ 연구개발 방법 초안 작성 📅 02-07 ⏫     │
│  ☐ 선행 연구 개발 섹션 작성 📅 02-10       │
│                                           │
│ 📁 초격차 지원서 작성 지원                  │
│  ☐ ...                                    │
└───────────────────────────────────────────┘
```

**패널 구성 (위에서 아래 순서):**

1. **⚠️ 미완료 (Overdue):** 오늘 이전 날짜의 데일리 노트에서 `- [ ]` 상태로 남아있는 타임라인 항목. 날짜와 원래 계획 시간을 함께 표시. 탐색 범위는 현재 보고 있는 주의 시작일부터 오늘 전날까지.
2. **📋 인박스:** 설정에 등록된 인박스 소스(노트 또는 폴더)에서 미완료 체크박스(`- [ ]`)를 수집. 소스는 정적 경로이며 개수 제한 없음. 소스별 동작:
   - **노트 소스 (헤딩 있음):** 해당 헤딩 아래의 미완료 체크박스만 읽기. 새 항목 추가 시 해당 헤딩 아래에 삽입.
   - **노트 소스 (헤딩 없음):** 노트 전체에서 미완료 체크박스 읽기. 새 항목 추가 시 파일 끝에 삽입.
   - **폴더 소스:** 하위 `.md` 파일을 재귀적으로 스캔하여 미완료 체크박스 읽기. 읽기 전용 (쓰기 불가). 데일리 노트 경로 패턴에 매칭되는 파일은 자동 제외 (`buildDailyNotePathRegex`로 moment.js 패턴을 RegExp으로 변환, `[...]` 대괄호 이스케이프 구문 지원).
   - **새 항목 추가:** 소스 목록의 순서(우선순위)에서 첫 번째 노트 소스(폴더 소스 제외)에 기록. 노트 소스가 없으면 추가 버튼 미표시.
3. **📁 프로젝트별 태스크:** 설정에 지정된 조건에 맞는 활성 프로젝트의 태스크 헤딩에서 미완료 태스크. *(현재 비활성화 — 프로젝트 기능 강화 후 재활성화 예정)*

**빈 상태 메시지:** 각 섹션에 항목이 없으면 맥락에 맞는 메시지 표시 (Overdue: "All caught up!", Inbox: "No items yet", Project: "No active projects")

**동작:**
- 패널의 항목을 타임테이블에 드래그하면 **새 타임라인 항목을 생성** (원본은 그대로 유지)
- 생성된 항목에는 내용이 텍스트로 완전히 기록되고, 원본으로의 블록 참조 링크가 포함됨
- 항목을 드래그하여 다른 날로 옮길 때, 원본 날짜가 **오늘 기준 과거**인 경우에만 `- [>]` (deferred) 처리:
  1. 원본 데일리 노트의 항목을 `- [>]`로 변경
  2. 새 날짜의 데일리 노트에 `- [ ]`로 타임라인 항목 생성
- 원본 날짜가 **오늘 또는 미래**인 경우에는 단순 이동 (원본 삭제 → 새 날짜에 생성)
- 타임테이블에서 Planning Panel로 되돌리면 **인박스로 반환** (우선순위 1위 노트 소스에 기록):
  - 원본이 과거 날짜 → `- [>]` deferred 처리 후 인박스에 태스크 추가
  - 원본이 오늘/미래 → 원본 삭제 후 인박스에 태스크 추가
  - **접근 방법:** 블록을 그리드 바깥으로 드래그(데스크톱), 또는 블록 컨텍스트 메뉴/더보기 메뉴에서 "Return to inbox" 선택(데스크톱+모바일)
  - **Undo:** 인박스에 추가된 항목의 위치를 추적하여, Undo 시 인박스에서 해당 항목을 제거하고 원본 블록을 복원
- 인박스 패널에서 **새 항목 직접 추가** 가능 (우선순위 1위 노트 소스에 기록, 노트 소스가 없으면 미표시)
- 인박스 아이템 **인라인 수정**: 우클릭 메뉴 "Edit" 또는 터치 액션 바 ✏ 버튼 → 아이템 텍스트가 입력 필드로 전환. Enter로 저장, Escape로 취소. 태그·Tasks 메타데이터는 보존되고 content만 교체
- 인박스 아이템 **삭제**: 우클릭 메뉴 "Delete" 또는 터치 액션 바 🗑 버튼 → 소스 노트에서 해당 라인 즉시 제거

```markdown
<!-- 과거 날짜에서 옮기는 경우: deferred 기록이 남음 -->
<!-- 2026-02-03.md (과거) -->
## Timeline
- [>] 09:00-11:00 API 설계 #work              ← deferred 처리됨

<!-- 2026-02-06.md (오늘) -->
## Timeline
- [ ] 09:00-11:00 API 설계 #work              ← 새로 계획됨

<!-- 오늘/미래 날짜에서 옮기는 경우: 단순 이동 -->
<!-- 2026-02-06.md (오늘) -->
## Timeline
(항목 삭제됨)                                   ← 흔적 없이 이동

<!-- 2026-02-07.md (내일) -->
## Timeline
- [ ] 09:00-11:00 API 설계 #work              ← 이동됨
```

#### 타임라인 항목 형식 (프로젝트 태스크 참조 시)

```markdown
- [ ] 09:00-11:00 연구개발 방법 초안 작성 [[중기부 RnD 사업 지원서 작성 지원#^task-001]] #work ⏫
```

- 내용이 텍스트로 완전히 기록되어 md 파일만으로 완결된 기록
- `[[프로젝트#^block-id]]` 링크는 원본 태스크로의 네비게이션 용도
- 프로젝트 태스크에 블록 ID(`^task-xxx`)가 없으면 WeekFlow가 자동 부여

#### 완료 시 동기화

프로젝트 태스크 참조가 있는 타임라인 항목을 완료(`- [x]`)할 때:

1. 원본 태스크 링크(`[[...#^...]]`)가 있는지 확인
2. 링크가 있으면 **"원본 태스크도 완료하시겠습니까?"** 확인 다이얼로그 표시
3. 사용자가 승인하면 프로젝트 노트의 원본 태스크도 `- [x]`로 변경
4. 사용자가 거부하면 타임라인 항목만 완료 (태스크를 나누어 진행하는 경우)

## Settings

| 항목 | 설명 | 기본값 | Phase |
|------|------|--------|-------|
| Daily Note Path | 데일리 노트 경로 패턴 (moment.js) | `YYYY-MM-DD` | 1 |
| Daily Note Template | 새 데일리 노트 생성 시 사용할 템플릿 파일 경로 | (빈 문자열) | 1 |
| Weekly Note Path | 주간 노트 경로 패턴 (moment.js) | `YYYY-[W]ww` | — |
| Weekly Note Template | 새 주간 노트 생성 시 사용할 템플릿 파일 경로 | (빈 문자열) | — |
| Timeline Heading | 타임라인 데이터가 위치할 헤딩 | `## Timeline` | 1 |
| Day Start Hour | 테이블 시작 시간 | `6` (06:00) | 1 |
| Day End Hour | 테이블 종료 시간 | `24` (00:00) | 1 |
| Week Start Day | 주 시작 요일 | `Monday` | 1 |
| Categories | 카테고리 목록 관리 | 기본 2개 (Work, Personal) | 1 |
| Inbox Sources | 인박스 소스 목록 (경로 + 선택적 헤딩, ▲/▼ 버튼으로 순서=우선순위 변경) | `[{path: "Inbox.md", heading: ""}]` | 3 |
| Default Block Duration | 패널에서 드래그 시 기본 블록 길이 (분) | `60` | 3 |
| Planning Panel Open | 패널 열림/닫힘 상태 유지 | `true` | 3 |
| Project Tag | 프로젝트 노트를 식별하는 태그 | `type/project` | 3 |
| Project Status Field | 프로젝트 상태를 나타내는 frontmatter 필드 | `status` | 3 |
| Project Active Statuses | 활성으로 간주할 상태 값 목록 (쉼표 구분) | `🟡 In Progress, 🔴 Urgent` | 3 |
| Project Tasks Heading | 프로젝트 내 태스크가 위치할 헤딩 | `## Tasks` | 3 |
| Presets | 타임 슬롯 프리셋 목록 | (빈 목록) | 3 |
| Review Heading | 회고 데이터가 위치할 헤딩 (데일리/주간 노트 공용) | `## Review` | 4 |
| Review Panel Open | 리뷰 패널 열림/닫힘 상태 유지 | `true` | 4 |
| Review Panel Height | 리뷰 패널 높이 (px, 드래그 리사이즈) | `160` | 4 |
| Review Panel Mode | 리뷰 패널 기본 모드 (`review` / `log`) | `log` | 4 |
| Logs Heading | 로그 데이터가 위치할 헤딩 | `## Logs` | 4 |
| Log Timestamp Format | 로그 타임스탬프 moment.js 포맷 | `HH:mm` | 4 |
| Calendar Sources | 외부 캘린더 ICS URL 목록 | (빈 목록) | 5 |
| Calendar Cache Duration | 캘린더 캐시 갱신 간격 (분) | `30` | 5 |
| Vim Mode | nvim 스타일 키보드 모드 활성화. 변경 시 리로드 필요. 모바일에서는 항상 비활성 | `true` | — |

#### Inbox Source 구조

```typescript
interface InboxSource {
  path: string;    // 노트 경로 (e.g., "Inbox.md") 또는 폴더 경로 (e.g., "Projects/Active")
  heading: string; // 읽기/쓰기 범위를 제한할 헤딩; 빈 문자열 = 노트 전체
}
```

- 소스 타입(Note/Folder)은 경로가 볼트 내 폴더인지 자동 감지하여 결정
- 순서가 우선순위: 배열의 첫 번째 노트 소스(폴더 제외)가 우선순위 1위 (새 항목 기록 대상)
- 설정 UI에서 ▲/▼ 버튼으로 순서 변경 (모바일 호환)

#### 자동 마이그레이션

플러그인 로드 시 이전 버전의 `inboxNotePath`/`inboxHeading` 설정이 있고 `inboxSources`가 없으면, 기존 값을 `inboxSources` 배열로 자동 변환한다. moment.js 동적 경로(`inboxNotePath`)는 현재 날짜 기준으로 해석하여 정적 경로로 변환한 후 마이그레이션하며, 이전 속성은 삭제된다.

#### 경로 미리보기

경로 패턴에 moment.js 토큰이 포함된 경우, 설정 화면에서 현재 날짜 기준으로 실제 파일 경로를 미리보기로 표시한다. 사용자가 패턴을 올바르게 지정했는지 즉시 확인할 수 있다.

```
Daily Note Path:  [5. Periodic Notes/YYYY/MM/YYYY-MM-DD  ]
  📄 Preview: 5. Periodic Notes/2026/02/2026-02-06.md

Inbox Sources:                           (▲/▼ 버튼으로 순서 변경)
  [▲▼] [Inbox.md              ] [### To Do ] [Note]   [✕]
  [▲▼] [Work/Tasks.md         ] [## Inbox  ] [Note]   [✕]
  [▲▼] [Projects/Active       ] [          ] [Folder] [✕]
                                              [+ Add Source]
```

## UI Components

### 1. Timetable View (Main)

- Obsidian 커스텀 뷰(Leaf)로 표시되는 메인 타임테이블
- 상단 툴바 (2줄 구성):
  - **Row 1:** 패널 토글 | `chevron-left` 주차·날짜 표시 `chevron-right` | Today | 도구 버튼(↻ ↩ ↪ Presets Stats Review) + 오버플로 `⋯` 메뉴. 주차 라벨 클릭 시 뷰 모드 메뉴(7d/3d/1d/Auto) 표시 — 라벨 우측에 `chevron-down` 아이콘으로 클릭 가능 어포던스 제공. 오늘이 현재 뷰 범위 밖일 때 오늘 방향의 네비 버튼 및 Today 버튼 하단에 accent 색상 dot 힌트 표시. 모든 네비/도구 버튼은 Lucide SVG 아이콘 사용 (일관성)
  - **Row 2:** 카테고리 팔레트 (가로 스크롤)
- ◀/▶ 버튼은 뷰 모드에 따라 역할 변경: 7일 뷰=주 이동, 3일 뷰=2일 단위 페이지 이동, 1일 뷰=1일 이동
- 도구 버튼이 공간 부족 시 `⋯` 오버플로 메뉴(Obsidian `Menu`)로 접근 가능
- 본문: Planning Panel(좌측) + 7일 x 시간대 그리드 + Daily Review Panel(하단)
- **블록 호버 버튼 (데스크톱, `@media (pointer: fine)`):**
  - 블록 hover 시 2개의 버튼 표시:
    - **토글 (우상단):** ○(Plan→Actual) 또는 ✓(Actual→Plan) 완료 상태 전환
    - **더보기 (우하단):** `more-horizontal` 아이콘. 클릭 시 우클릭과 동일한 컨텍스트 메뉴 표시 (Edit, Mark as Done/Incomplete, Go to daily note, Return to inbox, Delete)
  - "Go to daily note" 네비게이션은 더보기/우클릭 메뉴를 통해 접근
- **패널 아이템 (인박스/오버듀):** hover 시 우측에 `arrow-up-right` 아이콘 표시 → 인박스는 소스 노트, 오버듀는 데일리 노트로 이동. 우클릭 메뉴에도 동일 항목 제공. 인박스 아이템은 우클릭 메뉴에 Edit/Delete 추가 제공

### 2. Category Palette

- 타임테이블 옆 또는 상단에 카테고리 팔레트 표시
- 현재 선택된 카테고리를 하이라이트 (미선택 시 첫 번째 카테고리 자동 선택)
- 클릭으로 카테고리 전환 → 블록 생성 모달에 선택된 카테고리가 기본값으로 반영

### 3. Calendar Overlay (읽기 전용)

외부 캘린더 일정을 타임테이블 위에 오버레이로 표시한다. 플래닝 시 참고용이며, WeekFlow에서 캘린더를 수정하지 않는다 (단방향).

- **데이터 소스:** ICS URL 구독 (Google Calendar, Outlook 등에서 제공하는 iCal URL)
- **표시 방식:** WeekFlow 블록과 구분되는 반투명/빗금 스타일로 오버레이. `pointer-events: none`으로 캘린더 이벤트 위에서도 셀 클릭/드래그가 통과되어 블록 생성이 가능하다.
- **동작:** 뷰 렌더 후 비동기로 ICS를 fetch하여 오버레이만 패치 (뷰 블로킹 없음)
- **캐싱:** 매번 fetch하지 않고 설정의 Calendar Cache Duration 간격으로 캐싱. fetch 실패 시 만료된 캐시라도 반환 (오프라인 대응). 새로고침(↻) 버튼 클릭 시 캐시를 강제 초기화하여 최신 데이터를 refetch.
- **복수 캘린더:** 여러 ICS URL을 등록하고 각각 색상/표시 여부를 설정 가능. `Promise.allSettled()`로 소스별 독립 처리.

#### 설정

```typescript
interface CalendarSource {
  name: string;      // 표시 이름 (e.g., "회사 캘린더")
  url: string;       // ICS URL
  color: string;     // 오버레이 색상
  enabled: boolean;  // 표시 여부
}
```

### 4. Daily Review / Log Panel

타임테이블 하단에 7일분의 패널을 나란히 배치한다. 하나의 드로워 안에서 **Review 모드**와 **Log 모드**를 전환할 수 있으며, 계획(Plan) → 실행(Actual) → 회고(Review)의 사이클과 "지금 일어난 일을 빠르게 남기는 로그"를 같은 공간에서 다룬다.

```
┌─────────────────── Weekly Timetable ───────────────────┐
│  Mon   Tue   Wed   Thu   Fri   Sat   Sun               │
│  ...   ...   ...   ...   ...   ...   ...               │
├──────┬────────────────── Daily Review ─────────────────┤
│ R    │ Mon    │ Tue    │ Wed    │ Thu    │ Fri   │ Sat │
│ E    │ 오늘은 │ 집중이 │        │        │       │     │
│ V  ◀─┤ 설계에 │ 잘 안  │        │        │       │     │
│ I    │ 몰입.. │ 됐다.. │        │        │       │     │
│ E    │        │        │        │        │       │     │
│ W    │        │        │        │        │       │     │
│      │        │        │        │        │       │     │
│ L    │        │        │        │        │       │     │
│ O    │        │        │        │        │       │     │
│ G    │        │        │        │        │       │     │
└──────┴────────┴────────┴────────┴────────┴───────┴─────┘
       좌측 spacer의 수평 탭 레이블(REVIEW / LOG) 클릭으로 모드 전환
```

#### 공통

- 드로워 높이는 드래그 리사이즈 가능(설정 `Review Panel Height`)
- 열림/닫힘 상태는 툴바 토글 버튼 + `Review Panel Open` 설정으로 유지
- 좌측 spacer에 두 개의 수평 대문자 탭 레이블(`REVIEW`, `LOG`)이 세로 스택되어 있으며, 활성 모드는 `--text-normal`, 비활성 모드는 `--text-faint`로 표시. 클릭하면 즉시 모드가 전환되고 선택은 `Review Panel Mode` 설정에 저장된다
- **닫힘 상태 표시:** 리뷰 패널이 닫혀 있을 때 그리드 하단에 현재 모드명("Review" 또는 "Log")과 `chevron-up` 아이콘이 있는 탭 인디케이터를 표시. 클릭 시 패널 열림
- 새 설치에서는 `log` 모드가 기본 선택

#### Review 모드

- 각 칸은 해당 데일리 노트의 회고 헤딩(설정 `Review Heading`) 아래 내용을 textarea로 표시
- WeekFlow 뷰에서 직접 편집 가능 → 300ms 디바운스 후 데일리 노트에 반영 (blur 시 즉시 저장)
- 회고 헤딩이 없는 노트는 빈 칸으로 표시하되, 편집 시 헤딩이 자동 생성된다

#### Log 모드

- 각 칸은 해당 날짜의 `## Logs` 섹션(설정 `Logs Heading`)을 시간순 읽기 전용 리스트로 렌더링
- 각 항목은 `타임스탬프 + 내용` 형태로 표시되며, 마우스 hover 시 하이라이트되고 클릭하면 데일리 노트의 해당 라인으로 점프
- **오늘 컬럼**에는 리스트 하단에 quick-add 입력창(`+ log (now)...`)이 표시된다. 텍스트 입력 후 Enter:
  - 현재 wall-clock 시각(`HH:MM`)을 자동 캡처해 `- <timestamp> <text>` 라인을 append
  - 낙관적으로 즉시 UI에 반영 후 파일 쓰기
  - 입력창 자동 재포커스 → 연속 입력 가능
- **오늘 이외의 컬럼**은 읽기 전용(백필을 굳이 뷰어에서 지원하지 않음 — 데일리 노트를 직접 열어 편집)
- 로그 항목 편집/삭제는 현재 뷰어에서 지원하지 않으며, 원본 데일리 노트에서 수행

### 5. Statistics Panel

> **⚠️ UX 검토 필요:** 현재 통계는 별도 ItemView 탭으로 구현되어 있으나, WeekFlow 타임테이블 맥락에서 벗어나는 문제가 있다. 같은 뷰 안에서 "Timetable | Statistics" 탭 전환 방식으로 변경하면 주차 맥락을 유지하면서 통계를 확인할 수 있어 더 자연스러울 수 있다. 추후 리팩터링 검토.

타임테이블 또는 별도 탭에서 시간 사용 통계를 시각적으로 확인할 수 있다.

#### 조회 범위

통계 패널 상단에서 조회 범위를 전환할 수 있다. 각 범위에 맞는 네비게이션(이전/다음)을 제공한다.

| 범위 | 단위 | 예시 |
|------|------|------|
| Weekly | 1주 | 2026-W06 |
| Monthly | 1개월 | 2026-02 |
| Quarterly | 3개월 | 2026 Q1 |
| Yearly | 1년 | 2026 |
| Custom | 사용자 지정 기간 | 2026-01-01 - 2026-02-06 |

#### 카테고리별 시간 분배

```
이번 주 카테고리별 시간
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#work     Plan 20h  Actual 17.5h  ██████████████░░ 87%
#study    Plan 10h  Actual  8h    ████████░░░░░░░░ 80%
#exercise Plan  5h  Actual  3h    ██████░░░░░░░░░░ 60%
#rest     Plan  7h  Actual  9h    ████████████████ 128%
```

- 카테고리별 계획 시간 vs 실행 시간 비교
- 달성률을 프로그레스 바로 표시
- 100% 초과(계획보다 많이 한 경우)도 표현

#### 프로젝트별 시간 집계

```
이번 주 프로젝트별 시간
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
중기부 RnD 지원서       Plan 8h   Actual 6.5h
초격차 지원서            Plan 5h   Actual 5h
(프로젝트 없음)          Plan 12h  Actual 10h
```

- `[[프로젝트]]` 링크가 있는 항목을 프로젝트별로 그룹핑
- 링크가 없는 항목은 "(프로젝트 없음)"으로 집계

#### Burning Rate (시간 소비 추이)

조회 범위에 따라 하위 단위로 추이를 표시한다.

| 조회 범위 | 추이 단위 | 예시 |
|-----------|----------|------|
| Weekly | 일별 | Mon, Tue, ... Sun |
| Monthly | 주별 | W05, W06, W07, W08 |
| Quarterly | 월별 | Jan, Feb, Mar |
| Yearly | 월별 | Jan - Dec |

```
월간 카테고리별 추이 (2026-02)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       W05    W06    W07    W08
#work  18h    22h    19h    17.5h  ▼
#study  6h     8h    10h     8h    →
```

- 카테고리별 실행 시간 추이를 라인/바 차트로 표시
- 증가(▲), 유지(→), 감소(▼) 트렌드 표시
- 특정 카테고리에 시간을 너무 많이/적게 쓰고 있는지 파악 가능

#### 시간 분포

조회 범위에 따라 시간 사용 패턴을 표시한다.

| 조회 범위 | 분포 단위 |
|-----------|----------|
| Weekly | 요일별 |
| Monthly | 요일별 (평균) |
| Quarterly / Yearly | 월별 |

```
요일별 평균 활용 시간 (2026-02)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mon ████████████  12h
Tue ██████████    10h
Wed ████████████  12h
Thu ███████████   11h
Fri █████████      9h
Sat ██████         6h
Sun ████           4h
```

- 주중/주말 밸런스 확인
- 장기 범위에서는 월별 총 시간 분포로 계절적 패턴 파악

#### Plan vs Actual 요약

상단에 내러티브 요약 문장 표시 (e.g., "3 of 5 planned items completed, 2 deferred."), 그 아래 3개 요약 카드:

- **계획 이행률:** 계획한 항목 중 실행 완료된 비율. SVG progress ring으로 시각화, 색상 코딩 (≥75% 초록, ≥50% 노랑, <50% 빨강)
- **미루기 비율:** `- [>]` deferred 항목의 비율. SVG progress ring, 역방향 색상 코딩 (낮을수록 초록)
- **비계획 실행:** 계획 없이 `- [x]`로 바로 생성된 항목 수

## Responsive UI & Mobile

모바일(Obsidian Mobile)과 다양한 화면 크기에서 동일한 기능을 반응형 UI로 제공한다. **디바이스 타입이 아닌 가용 너비(available width)를 기준으로** 레이아웃을 결정하며, `ResizeObserver`로 실시간 감시하여 데스크톱 창 리사이즈, Split View, 오리엔테이션 전환 모두 하나의 로직으로 처리한다.

### 레이아웃 브레이크포인트 (너비 기반)

| 뷰 너비 | Layout Tier | 표시 일수 | Planning Panel | Review Panel |
|---------|-------------|----------|----------------|--------------|
| **≥ 900px** | `wide` | 7일 | 사이드 패널 | 7칸 |
| **500~899px** | `medium` | 3일 | 사이드 패널 (220px, 접힘 가능) | 표시 일수만큼 |
| **< 500px** | `narrow` | 1일 | 드롭다운 패널 (top-anchored) | 1칸 |

- 데스크톱에서 창을 줄이면 자연스럽게 7일→3일→1일로 전환, 넓히면 복원
- iPad 가로=Wide, iPad Split View=Medium, iPhone 세로=Narrow, iPhone 가로=Medium
- `ResizeObserver`가 `.weekflow-container`의 `contentRect.width`를 감시하므로 오리엔테이션 전환 시 자동 대응

#### 수동 뷰 모드 전환

기본값은 Auto(위 반응형 동작)이지만, 사용자가 주차 라벨을 클릭하여 수동으로 뷰 모드를 선택할 수 있다.

- **주차 라벨 클릭** → Obsidian `Menu`로 4개 항목 표시: 7 days / 3 days / 1 day / Auto
- **Override 활성 시**: 주차 라벨 뒤에 `(7d)` 같은 인디케이터 표시
- **CSS layout tier는 항상 실제 너비 기반**: override 시에도 패널 레이아웃(사이드/바텀시트)은 실제 너비에 따라 적응
- **스와이프 게이팅**: override로 3일 뷰를 넓은 화면에서 사용할 때 스와이프가 동작하도록 `currentVisibleDays` 기반으로 판단
- **세션 내 지속**: `viewModeOverride`를 Obsidian view state에 저장/복원 (플러그인 설정에는 저장하지 않음)

### 디바이스 감지 (`src/device.ts`)

```typescript
type DeviceTier = "desktop" | "tablet" | "phone";
type LayoutTier = "wide" | "medium" | "narrow";

// Obsidian body class 기반 디바이스 감지 (보조)
function getDeviceTier(): DeviceTier;  // .is-tablet, .is-mobile
function isMobileDevice(): boolean;

// 뷰 너비 기반 레이아웃 결정 (핵심)
function getLayoutTier(viewWidth: number): LayoutTier;
function getVisibleDays(tier: LayoutTier): 1 | 3 | 7;
function isTouchDevice(): boolean;
function hapticFeedback(): void;
```

### Pointer Events

모든 인터랙션은 Pointer Events API(`pointerdown`/`pointermove`/`pointerup`/`pointercancel`)로 통합 구현되어 마우스, 터치, 펜 입력을 처리한다. 셀 선택은 `e.pointerType`으로 터치/마우스를 분기한다.

- **마우스 (`pointerType !== "touch"`):** 셀 `pointerdown`에서 `preventDefault()` 호출 → `cell-select` 드래그 모드로 다중 셀 선택
- **터치 (`pointerType === "touch"`):** 셀 `pointerdown`에서 `preventDefault()` 미호출 (스크롤 허용) → 탭-탭 상태머신(`touchTapState`)으로 셀 선택. `pointerup`에서 이동 거리 <10px이면 탭으로 처리, >50px 수평이면 스와이프. `pointercancel`에서도 스와이프 판정 수행 (`touch-action: pan-y`로 인해 세로 스크롤 시 `pointercancel` 발생)
- 리사이즈 핸들에 `setPointerCapture()`를 적용하여 요소 밖으로 드래그해도 이벤트 유지
- **데스크톱 블록 드래그:** 150ms 딜레이 후 시작
- **터치 블록 드래그:** 롱프레스 대신 선택 모드 → 이동 모드 진입 방식 (터치 블록 인터랙션 참조). 이동 모드에서만 `preventDefault()` + `touch-action: none` 적용
- **Apple Pencil 블록 드래그:** 마우스와 동일하게 150ms 홀드 후 직접 드래그. 리사이즈 핸들도 직접 드래그 가능. 탭 시에는 터치와 동일하게 액션 바 표시. 패널에서 펜 탭 감지는 `click`이 아닌 `pointerup`으로 처리 — `pointerdown`에서 `preventDefault()` 호출 시 iPadOS Safari가 `click`을 suppress하므로 `pointerup`이 150ms 타이머를 확실히 취소할 수 있음
- **블록 툴팁:** 작은 블록에서 잘리는 타이틀을 확인할 수 있는 커스텀 툴팁. 시간과 내용을 `HH:MM-HH:MM content` 형식으로 표시. 입력 방식별 트리거:
  - **마우스/Apple Pencil:** `pointerenter` 후 300ms 딜레이로 표시, `pointerleave` 시 즉시 숨김
  - **터치(손가락):** 액션 바가 툴팁 역할을 대체 (별도 툴팁 미표시)
  - 툴팁은 블록 상단에 `position: fixed`로 배치되며, 뷰포트 경계 클램핑 적용 (상단 넘침 시 블록 하단으로 전환)

### 스와이프 네비게이션

빈 셀 영역에서의 가로 스와이프를 감지하여 날짜/주 이동:

- **감지 기준:** 가로 이동 >50px, |가로| > |세로|*2, 시간 <300ms
- **감지 시점:** `pointerup` 및 `pointercancel` 모두에서 판정 (브라우저가 세로 스크롤로 인해 `pointercancel`을 발생시켜도 수평 스와이프 데이터를 활용)
- **Obsidian 사이드바 차단:** WeekFlow 뷰 컨테이너(`contentEl`)에서 `touchmove` `stopPropagation()`을 무조건 호출하여 뷰 전체에서 사이드바 제스처를 차단. 네이티브 세로 스크롤은 `touch-action: pan-y`가 JS 전파와 독립적으로 브라우저에서 처리되므로 영향 없음
- **Wide + 터치:** 스와이프 → 주 이동
- **Medium (3일):** 스와이프 → dayOffset ±2 (고정 페이지 [0,2,4], 주 경계 넘으면 주 이동)
- **Narrow (1일):** 스와이프 → dayOffset ±1 (주 경계 넘으면 주 이동)
- **7일 뷰 + 데스크톱:** 제스처 스와이프 비활성화 (마우스 드래그와 충돌 방지). 단, ◀/▶ 버튼은 동작. override로 3일 뷰를 넓은 화면에서 사용할 때는 스와이프 동작

### 드롭다운 패널 (Narrow 모드 Planning Panel)

Narrow 모드에서 사이드 패널 대신 상단 고정(top-anchored) 드롭다운 패널로 표시:

- `collapsed` 상태: 패널 숨김
- `expanded` 상태: 최대 높이 60% (`.weekflow-body` 기준)
- 툴바의 패널 토글 버튼으로 열기/닫기 (Wide/Medium에서는 사이드 패널, Narrow에서는 드롭다운 패널)
- 배경 백드롭(`.weekflow-dropdown-backdrop`) 탭으로 닫기
- 내부에 PlanningPanel 컴포넌트를 재사용
- **패널 아이템 드래그 시 자동 접기:** 인박스/오버듀 아이템의 드래그가 시작되면 드롭다운 패널을 자동으로 `collapsed` 상태로 전환하여 그리드가 보이도록 함

#### 모바일 키보드 회피 (Mobile Keyboard Avoidance)

모바일에서 드롭다운 패널 내 입력 필드(Add item...)를 탭하면 가상 키보드가 올라오면서 패널이 이중 축소되는 문제를 방지:

- **문제:** 키보드 → Obsidian 웹뷰 리사이즈 → `.weekflow-body` 축소 → `max-height: 60%` 재계산으로 패널이 이중으로 줄어듦
- **해결:** `visualViewport` API로 키보드 출현을 감지하고, 패널의 `max-height`를 CSS `60%` 대신 **실제 가용 높이**(패널 top ~ 키보드 top)로 오버라이드
- `isMobileDevice()` 가드로 모바일에서만 활성화 (데스크톱 영향 없음)
- `focusin` 시 `visualViewport.resize` 리스너 등록, `focusout` 시 해제 (패널 내 다른 input으로 포커스 이동 시 깜빡임 방지를 위해 100ms 딜레이)
- `requestAnimationFrame` + `scrollIntoView({ block: "nearest" })`로 포커스된 입력 필드가 패널 스크롤 영역 내에서 항상 보이도록 보장
- 키보드 닫히면 `style.maxHeight = ""`로 CSS 기본값 복원

### dayOffset 로직

- **7일 (wide):** offset=0 (월~일 전부 표시)
- **3일 (medium):** 고정 페이지 [0, 2, 4] — 1일 오버랩으로 주 전체 커버
  - 월화수(0) → 수목금(2) → 금토일(4)
  - Today 버튼: today가 포함되는 가장 앞 페이지 (과거 맥락 우선). 같은 주 내에서도 `pendingDayOffset`을 설정하여 올바른 페이지로 이동 (주 변경 없이 offset만 갱신)
  - 매핑: 월화수→0, 목금→2, 토일→4
  - ◀/▶ 이동: 항상 2일 단위 (예측 가능한 네비게이션)
  - 주 경계 착지: ◀(뒤로) → 이전 주 마지막 페이지(4), ▶(앞으로) → 다음 주 첫 페이지(0). `pendingDayOffset`으로 `refresh()` 시 자동 재계산을 오버라이드
- **1일 (narrow):** 오늘의 dayIndex, ◀/▶로 1일씩 이동
- 주 변경 시 dayOffset 자동 재계산 (단, `pendingDayOffset`이 설정되어 있으면 해당 값 사용)

### CSS 터치 최적화

#### hover → `@media (pointer: fine)` 격리

13개 `:hover` 규칙을 `@media (pointer: fine)` 블록으로 이동하여 터치 디바이스에서 hover가 stuck되지 않도록 방지.

#### `@media (pointer: coarse)` — 터치 디바이스

- 블록 토글 버튼 항상 표시 (opacity 0.5)
- 리사이즈 핸들 6px→16px 확대

#### touch-action 설정

- **`.weekflow-grid`:** `touch-action: pan-y` — 세로 스크롤은 브라우저에 위임, 수평 제스처는 JS에서 처리 (스와이프 감지).
- **`.weekflow-resize-handle`, `.weekflow-review-resize-handle`, `.weekflow-bottom-sheet-handle`:** `touch-action: none` — 드래그 전용 요소에서 브라우저 기본 제스처 완전 차단.
- **`.weekflow-block`, `.weekflow-panel-item`:** 기본 `touch-action: pan-y` (스크롤 허용). 이동 모드 진입 시에만 동적으로 `touch-action: none` 적용.
- **`.weekflow-cell`:** 부모(`.weekflow-grid`)의 `pan-y`를 상속 — 셀 위에서 세로 스크롤 허용.

#### 터치 타겟 (`.is-mobile`)

- 툴바 버튼: min-width/height 36px
- 패널 아이템: padding 10px 12px, min-height 44px
- 블록 토글 버튼: 28px×28px
- 오버랩 핸들: 16px×16px

#### Statistics 반응형

`@media (max-width: 600px)`: 헤더 세로 배치, 요약 카드 1열, 차트 세로 배치

### 접근성 & 디자인 토큰

#### 키보드 포커스

모든 인터랙티브 요소(button, block, toggle, more, fold bar, panel item, category dot, stats range button, overlap handle)에 `:focus-visible` 스타일 적용:
```css
outline: 2px solid var(--interactive-accent);
outline-offset: 1px;
```

#### CSS 디자인 토큰

`.weekflow-container`에 box-shadow 토큰 정의:
```css
--shadow-sm: 0 0 2px rgba(0, 0, 0, 0.2);
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.12);
--shadow-lg: 0 2px 12px rgba(0, 0, 0, 0.15);
--shadow-xl: 0 4px 16px rgba(0, 0, 0, 0.12);
```

모든 `box-shadow` 값은 토큰 참조. 하드코딩된 rgba shadow 사용 금지.

#### 색상 처리

- 블록 actual 배경, deferred 투명도, ghost 요소 등 알파 채널이 필요한 색상은 `color-mix(in srgb, <color> <percent>, transparent)` 사용 (hex 외 형식에서도 동작)
- 테마 종속 색상은 Obsidian CSS 변수 사용 (`var(--text-on-accent)`, `var(--background-modifier-cover)` 등). 하드코딩된 `white`, `black`, `rgba()` 사용 금지

### 오리엔테이션 전환

별도의 `orientationchange` 이벤트 리스너 불필요. `ResizeObserver`가 뷰 너비 변경을 즉시 감지하여 브레이크포인트를 재평가한다.

| 디바이스 | 세로(Portrait) | 가로(Landscape) |
|---------|---------------|----------------|
| **iPhone** | Narrow (1일) | Medium (3일) |
| **iPad** | Wide (7일) | Wide (7일) |
| **iPad Split View** | Medium (3일) | Wide or Medium |
| **Desktop 좁은 창** | Medium 또는 Narrow | — |

### 모바일 전용 고려사항

- **스크롤 충돌 방지:** 그리드와 블록 모두 `touch-action: pan-y`로 세로 스크롤 허용, 터치 셀 선택은 탭-탭 방식으로 드래그와 분리. 블록 터치 시 `preventDefault()` 미호출로 스크롤 유지. 블록 이동/리사이즈는 선택 모드 → 이동 모드 진입 후에만 가능하여 스크롤과 드래그가 완전히 분리됨 (터치 블록 인터랙션 참조). 패널 아이템도 선택 전까지 `preventDefault()` 미호출로 스크롤 허용.
- **햅틱 피드백:** 이동 모드 진입 시 `navigator.vibrate(10)` 호출.
- **오프라인 동작:** 데이터가 로컬 마크다운 파일이므로 오프라인에서도 완전히 동작. 캘린더 오버레이만 캐시 기반으로 제한적 표시.
- **Split View / Stage Manager (iPad):** `ResizeObserver`로 실제 뷰 영역 크기를 감시하여 레이아웃을 동적으로 적응. 디바이스 타입이 아닌 실제 가용 너비를 기준으로 컬럼 수를 결정하므로, Stage Manager에서 창 크기를 자유롭게 변경해도 자연스럽게 대응.
- **키보드 회피 (드롭다운 패널):** 모바일에서 드롭다운 패널 내 입력 필드 포커스 시 `visualViewport` API로 키보드 제외 가용 높이를 계산하여 `max-height`를 오버라이드. 키보드 닫히면 CSS 기본값 복원. `isMobileDevice()` 가드로 데스크톱 미영향.
- **모달 필드 순서 (키보드 가시성 최적화):** BlockModal / EditBlockModal의 필드 순서를 Content → Category → Time → Action buttons 순으로 배치. Content 입력 필드가 모달 상단에 위치하여 모바일 가상 키보드가 올라와도 항상 보이도록 보장.
- **IME 조합 보호 (Korean IME 등):** 모든 Enter 키 제출 핸들러(`BlockModal`, `EditBlockModal`, `PlanningPanel`)에서 `e.isComposing` 체크. IME 조합 중 Enter는 글자 확정용이므로 폼 제출을 무시하고, 조합 완료 후 다음 Enter에서만 제출 실행.

## Implementation Phases

### Phase 1 — Core (MVP) ✅

**목표:** 데일리 노트를 읽어서 주간 타임테이블로 보여주고, 타임테이블에서 블록을 만들면 데일리 노트에 기록되는 기본 루프 완성.

- 플러그인 스캐폴딩 (manifest.json, main.ts, settings tab)
- 설정: Daily Note Path, Timeline Heading, Day Start/End Hour, Week Start Day, Categories
- 타임라인 파서: 지정된 헤딩 아래 `- [ ]` / `- [x]` / `- [>]` 리스트 읽기/쓰기
- 타임테이블 뷰 (`ItemView`): 7일 × 시간대 그리드 렌더링
- 셀 클릭/드래그로 새 블록 생성 (시간/내용/카테고리 입력 모달, 드래그 범위로 시간 초기화 후 모달에서 수정 가능)
- 통합 뷰: Plan(outline)과 Actual(fill)을 동시 표시. 과거 날짜는 자동으로 Actual, 오늘/미래는 Plan으로 생성
- 카테고리 팔레트 (태그 → 색상 매핑)
- 주 네비게이션 (이전/다음 주)
- `- [x] HH:MM-HH:MM > HH:MM-HH:MM` 형식 파싱 및 렌더링

**이 Phase가 끝나면:** WeekFlow를 열고, 블록을 만들고, 데일리 노트에서 결과를 확인할 수 있다. 데일리 노트를 직접 수정하면 뷰를 다시 열 때 반영된다.

### Phase 2 — 블록 편집 & 동기화 ✅

**목표:** 블록을 자유롭게 조작하고, 데일리 노트와 실시간으로 동기화.

- 블록 드래그 이동 (같은 날 시간 이동 + 다른 날로 이동)
- 블록 경계 드래그 리사이즈
- 블록 클릭 시 내용/카테고리/시간 편집, 삭제
- 블록 완료 토글 (○/✓ 버튼으로 Plan ↔ Actual 전환)
- Actual 블록 편집 시 계획 시간 읽기 전용 + 실행 시간 편집
- 실시간 양방향 동기화 (WeekFlow ↔ 데일리 노트 능동 편집 시)
- 포커스 복귀 시 데이터 재로딩
- 자정 넘김 항목 자동 분리 (overnight)
- Undo/Redo 스택 (블록 이동, 리사이즈, 생성, 삭제, 완료/미완료에 대한 되돌리기)
- 5분 단위 대각선 블록 렌더링 (clip-path), EditBlockModal에서 5분 단위 입력.
- 에러 핸들링: 파싱 불가 항목은 무시하되, 뷰 상단에 경고 배너 표시.
- 시간 겹침 블록: 겹치는 블록 그룹 상단 바깥에 카테고리 색상 핸들(원형 점)을 호버 시 표시. 핸들 클릭으로 블록 선택 시 두꺼운 테두리(3px)와 그림자로 강조, 나머지 블록은 dim 처리(opacity 0.3). 빈 셀 클릭 시 선택 해제.
- 다중 행 블록: 콘텐츠 텍스트는 가장 넓은 세그먼트에 표시하여 좁은 세그먼트에서의 행 높이 변동 방지.
- 그리드 행 높이 안정화: 타임라인 블록은 `position: absolute`로 그리드 트랙 크기 계산에서 제외되어 행 높이가 블록 콘텐츠에 영향받지 않음. 고스트 블록(드래그 프리뷰)은 `white-space: nowrap; text-overflow: ellipsis`로 텍스트 줄바꿈 방지.
- 블록 우클릭 컨텍스트 메뉴: Edit / Mark as Done(or Incomplete) / Go to daily note / Return to inbox / Delete. Obsidian 네이티브 `Menu` 사용.
- EditBlockModal 완료 토글: Plan 블록에 "Mark as Done", Actual 블록에 "Mark as Incomplete" 버튼. Deferred 블록 미표시.

**이 Phase가 끝나면:** 타임테이블에서 블록을 자유롭게 드래그하고 편집할 수 있고, 데일리 노트와 실시간으로 연동된다.

### Phase 3 — 플래닝 워크플로우 ✅

**목표:** 할 일을 모아보고, 시간에 배치하고, 미완료 항목을 관리하는 플래닝 사이클.

- Planning Panel (사이드바, 토글 가능)
- 인박스 연동: 등록된 인박스 소스(노트/폴더)에서 미완료 체크박스 수집 (헤딩 있으면 해당 섹션만, 없으면 전체, 폴더는 재귀 스캔하되 데일리 노트 자동 제외)
- 인박스 패널에서 새 항목 직접 추가 (우선순위 1위 노트 소스에 기록)
- 인박스 아이템 인라인 수정 및 삭제 (우클릭 메뉴 + 터치 액션 바)
- 설정: Inbox Sources (경로 + 선택적 헤딩, ▲/▼ 버튼으로 순서=우선순위 변경), Default Block Duration
- 이전 `inboxNotePath`/`inboxHeading` 설정에서 `inboxSources`로 자동 마이그레이션
- 미완료(Overdue) 항목 수집 및 표시
- Deferred 처리: 과거 날짜 이동 시 `- [>]`, 오늘/미래는 단순 이동
- 인박스로 되돌리기 기능 (우선순위 1위 노트 소스에 기록)
- 프로젝트 태스크 연동: `metadataCache`로 활성 프로젝트 탐색, 미완료 태스크 패널 표시
- 설정: Project Tag, Project Status Field, Project Active Statuses, Project Tasks Heading
- 드래그로 타임라인에 배치 시 텍스트 복사 + `[[프로젝트#^block-id]]` 링크 (block ID 자동 부여)
- 완료 시 원본 태스크 완료 확인 다이얼로그 (ConfirmModal)
- 타임 슬롯 프리셋: 현재 날짜에서 생성, 요일 선택 적용, 덮어쓰기/병합 옵션
- 모든 동작에 Undo 지원

**이 Phase가 끝나면:** 인박스와 프로젝트에서 할 일을 끌어와 주간 계획을 세우고, 미완료 항목을 추적/미루기 할 수 있다.

### Phase 4 — 회고 & 통계 ✅

**목표:** Plan → Actual → Review 사이클 완성 및 시간 사용 분석.

- Daily Review Panel (타임테이블 하단, 7일 회고, 날짜 칼럼과 정렬)
  - 인라인 textarea 편집, 300ms debounce 저장 + blur 즉시 저장
  - 토글 버튼으로 접기/펼치기, 상태 저장
  - 드래그 리사이즈 핸들 (min 60px, max 500px, 높이 설정 저장)
  - `scrollbar-gutter: stable`로 그리드-리뷰 칼럼 정렬
  - Review 헤딩이 없으면 Timeline 섹션 바로 뒤에 자동 삽입
- 설정: Review Heading, Review Panel Open, Review Panel Height
- 회고 직접 편집 → 데일리 노트 반영 (양방향 동기화)
- Statistics View (별도 ItemView 탭): 주간 카테고리별 시간 분배
- 프로젝트별 시간 집계
- Plan vs Actual 요약 (이행률, 미루기 비율, 비계획 실행)
- 다중 범위 통계 (주간, 월간, 분기, 연간)
- Burning rate 추이 차트 (스택형 바 차트, 순수 HTML/CSS)
- 시간 분포 (요일별/월별, 가로 막대 차트)
- 증분 파싱 캐싱 (StatsCache, mtime 기반 캐시 히트)
- Navigate to Source: 블록 hover 시 `arrow-up-right` 아이콘으로 데일리 노트 이동 (커서 위치 이동), 패널 아이템 hover 시 소스 노트/데일리 노트 이동. 우클릭 메뉴에서도 동일 기능 제공. 데스크톱 전용 (`@media (pointer: fine)`)

**이 Phase가 끝나면:** 주간 회고를 작성하고, 시간 사용 패턴을 다양한 범위에서 분석할 수 있다.

### Phase 5 — 외부 연동 & 커맨드 ✅

**목표:** 외부 캘린더 통합, 커맨드 팔레트 지원, 편의 기능.

- Calendar Overlay: ICS URL 구독 (`ical.js` 라이브러리), `requestUrl`로 CORS 우회 페칭, 인메모리 캐시 (stale cache fallback), VTIMEZONE 등록 (`ICAL.TimezoneService`), 반복 이벤트 확장 (`Event.iterator()`, 이벤트 DTSTART 기준, MAX_EXPANSIONS=3650), 타임존 인식 범위 필터링 (`toJSDate().getTime()`), `Promise.allSettled()`로 소스별 병렬 처리, 빗금+점선 오버레이 렌더링 (z-index 2, 타임라인 블록 아래), all-day 이벤트 스킵
- 설정: Calendar Sources (name, URL, color, enabled, delete), Calendar Cache Duration (슬라이더 0~120분)
- Obsidian 커맨드 등록 (Phase 1~3에서 이미 구현된 것 포함):
  - `WeekFlow: Open weekly view` ✅
  - `WeekFlow: Undo` (Mod+Z) ✅
  - `WeekFlow: Redo` (Mod+Shift+Z) ✅
  - `WeekFlow: Toggle planning panel` ✅
  - `WeekFlow: Go to this week` ✅
  - `WeekFlow: Open statistics` ✅
- 리본 아이콘 (사이드바에서 WeekFlow 열기) ✅

**이 Phase가 끝나면:** 외부 일정을 참고하면서 계획을 세울 수 있고, 커맨드 팔레트로 빠르게 접근할 수 있다.

### Phase 6 — 반응형 UI + 모바일 최적화 ✅

**목표:** 뷰 너비 기반 반응형 레이아웃 + Pointer Events로 모바일/태블릿/데스크톱 통합 대응.

- `src/device.ts`: DeviceTier, LayoutTier, `getLayoutTier(viewWidth)`, `getVisibleDays(tier)`, `isTouchDevice()`, `hapticFeedback()`
- 너비 기반 3-tier 레이아웃: Wide(≥900px, 7일) / Medium(500~899px, 3일) / Narrow(<500px, 1일)
- `ResizeObserver`로 `.weekflow-container` 너비 실시간 감시 → 브레이크포인트 자동 전환
- Pointer Events API로 모든 mouse 이벤트 통합 (`pointerdown`/`pointermove`/`pointerup`)
- `setPointerCapture()`로 리사이즈 핸들 드래그 안정화
- 동적 `visibleDays`/`dayOffset`로 표시 범위 제어 (GridRenderer.setVisibleRange)
- 터치 셀 선택: 탭-탭 방식 (`touchTapState` 상태머신). 드래그는 스크롤/스와이프 전용으로 해방
- 스와이프 네비게이션: `pointerup`/`pointercancel` 양쪽에서 감지. `touchmove` `stopPropagation()`으로 Obsidian 사이드바 차단
- 3일 뷰 고정 페이지: [0,2,4] (1일 오버랩), 2일 단위 스텝으로 예측 가능한 네비게이션
- 터치 블록 인터랙션: 선택 모드(액션 바) → 이동 모드(드래그/리사이즈) → 확인/취소. 롱프레스 제거, 명시적 버튼 기반. 이동 모드에서 고스트 블록에 리사이즈 핸들 자동 추가, 여러 번 드래그/리사이즈 반복 가능. 취소 시 누적 위치 원래 값으로 리셋
- Apple Pencil은 마우스 경로로 처리: 150ms 홀드 후 직접 드래그, 리사이즈 핸들 직접 드래그, 호버 시 툴팁만 표시. 탭 시에만 터치와 동일하게 액션 바 표시. 패널 펜 탭은 `pointerup`으로 감지 (`preventDefault()`가 `click`을 suppress하는 iPadOS Safari 대응)
- Narrow 모드: 상단 고정 드롭다운 패널 Planning Panel (collapsed/expanded, 백드롭 탭 닫기, 툴바 패널 토글과 연동, 드래그 시 자동 접기, 모바일 키보드 회피: `visualViewport` API로 실제 가용 높이 계산)
- 툴바 2줄 구조: Row 1 (nav + tools + `⋯` 오버플로 메뉴), Row 2 (카테고리 팔레트, 가로 스크롤). ◀/▶ 버튼이 뷰 모드별 역할 변경
- `@media (pointer: fine)`: hover 효과를 마우스 전용으로 격리
- `@media (pointer: coarse)`: 항상 표시 토글/리사이즈 핸들, 터치 타겟 보장
- `.weekflow-grid`와 `.weekflow-block`에 `touch-action: pan-y` (세로 스크롤 허용), 리사이즈 핸들은 `touch-action: none`
- 모바일 하단 네비 바 대응: `.is-mobile .weekflow-container`에 `env(safe-area-inset-bottom)`, `.is-mobile .weekflow-grid-wrapper`에 `padding-bottom: 48px`
- 모바일 드롭다운 패널: 상단 고정 배치, `max-height: 60%`, 백드롭 탭으로 닫기
- `pointercancel` 시 `dragMode` 리셋 (Apple Pencil 리프트/팜 리젝션 대응)
- `getCellFromPoint()`: `getBoundingClientRect()`가 스크롤 반영하므로 `scrollLeft/Top` 미가산
- 같은 주 내 페이지 이동: `updatePage()`로 그리드+툴바+리뷰만 업데이트 (전체 재렌더 안 함)
- 프로젝트 섹션 비활성화: 프로젝트 기능 강화 시 재활성화 예정 (관련 코드 보존)
- `renderView()` 전 기존 `GridRenderer.destroy()` 호출 (글로벌 리스너 누수 방지)
- Review Panel 칼럼 수 visibleDays 연동
- Statistics 뷰 좁은 화면 세로 배치 (`@media max-width: 600px`)
- 수동 뷰 모드 전환: 주차 라벨 클릭 → 메뉴(7d/3d/1d/Auto), view state 저장, CSS tier와 visibleDays 분리

**이 Phase가 끝나면:** 데스크톱 창 리사이즈, iPad Split View, iPhone 세로/가로 어디서든 WeekFlow를 사용할 수 있다. 사용자가 원하면 수동으로 뷰 모드를 고정할 수도 있다.

### Phase 간 의존성

```
Phase 1 (Core MVP)
  └─▶ Phase 2 (블록 편집 & 동기화)
        ├─▶ Phase 3 (플래닝)
        │     └─▶ Phase 4 (회고 & 통계)
        ├─▶ Phase 5 (외부 연동 & 커맨드)
        └─▶ Phase 6 (반응형 UI + 모바일) ✅
```

Phase 2 완료 후 Phase 3~6은 독립적으로 진행 가능하나, Phase 4는 Phase 3의 데이터(Deferred, 프로젝트 링크)를 통계에 활용하므로 Phase 3 이후가 자연스럽다.

### 6. Current Time Indicator

Google Calendar 스타일의 현재 시간 표시선. 오늘 컬럼에 빨간 수평선과 좌측 원형 dot으로 현재 시간 위치를 표시한다.

- **표시 조건:** 오늘이 visible range에 포함되고, 현재 시간이 folded hour가 아닐 때 표시. folded hour이면 `display: none`으로 숨김
- **위치 계산:** 블록과 동일한 CSS Grid placement 패턴 사용. `grid-row`/`grid-column`으로 오늘 컬럼의 해당 시간 행에 배치하고, `position: absolute` + 퍼센트 `top`(`currentMinute / 60 * 100%`)으로 행 내 위치 지정. 그리드 크기 변화(review 패널 토글, 윈도우 리사이즈 등) 시 브라우저가 자동으로 위치 조정
- **DOM 재사용:** 매 갱신 시 기존 DOM 요소를 재사용하고 style property만 업데이트. `isConnected` 체크로 full re-render 후 stale 참조 감지
- **업데이트:** `setInterval(60000)`으로 매 분 위치 갱신. `render()` 시 이전 interval 정리 후 새로 생성
- **스타일:** 2px 빨간 수평선 (`#EA4335`) + 8px 원형 dot, `z-index: 15` (블록 위, 오버랩 핸들 아래)
- **반응형:** 7일/3일/1일 뷰 모드 전환 및 다른 주 이동 시 자동으로 표시/숨김

### 7. Time Range Fold (시간대 접기)

설정의 `dayStartHour`~`dayEndHour` 범위 바깥 시간대(이른 아침/심야)를 접어서 화면 공간을 절약한다. 24시간 그리드(0~24시)를 유지하면서, 사용 빈도가 낮은 시간대를 한 줄짜리 fold bar로 축소한다.

- **접기 영역:** `dayStartHour > 0`이면 상단(0:00~dayStartHour), `dayEndHour < 24`이면 하단(dayEndHour~24:00)
- **초기 상태:** 양쪽 모두 접힌 상태(`earlyFolded = true`, `lateFolded = true`). 세션마다 초기화 (설정에 저장하지 않음)
- **Grid 구조:** fold bar는 별도 grid row로 분리. `Row 1: Header, Row 2: Early fold bar (28px), Row 3–26: Hour 0–23, Row 27: Late fold bar (28px)`. `HOUR_ROW_OFFSET = 3`
- **Fold bar (항상 표시):**
  - 접기/펼치기 상태와 무관하게 **항상** 고정 위치에 표시 (28px)
  - 라벨 셀(1열) + 날짜별 셀(각 요일 컬럼)으로 분리
  - **라벨 셀:** `▾/▴ HH:MM–HH:MM` 형태. 화살표는 숨겨진 콘텐츠 방향을 가리킴
  - **날짜 셀 (접힌 상태만):** 해당 시간대에 숨겨진 블록이 있으면 `▾ [N]` 형태로 카운트 배지 표시
  - 실선 테두리 + `var(--background-secondary)` 배경 (접힌/펼친 상태 동일)
  - 접근성: `role="button"`, `tabindex="0"`, Enter/Space 키 지원
  - 커맨드 팔레트: `Toggle early hours fold` / `Toggle late hours fold`
- **화살표 방향:** 콘텐츠가 있는 방향을 가리킴. 상단 접힘=▾(아래 펼치기), 상단 펼침=▴(위로 접기). 하단 접힘=▴(위 펼치기), 하단 펼침=▾(아래 접기)
- **접힌 상태:** fold zone 시간대(0~dayStartHour-1 / dayEndHour~23) 행 높이 0px
- **펼친 상태 (fold zone):**
  - 모든 fold zone 시간이 **일반 행과 동일하게** 렌더: 일반 높이(`minmax(40px, 1fr)`), 10분 그리드 셀, 시간 레이블
  - Fold zone 셀에 `weekflow-fold-zone` 클래스 — 시간대별 밴딩(hour-even/weekend) 리듬을 유지하면서 일반 영역보다 진한 배경 tint 적용
  - Fold zone 타임 레이블(1열)에 `border-right` 적용 — fold bar 라벨 셀과 세로로 이어져 한 덩어리로 보임
  - Fold zone 마지막/첫 시간 레이블에 edge 구분선(`weekflow-fold-zone-edge-early/late`) — fold zone과 일반 영역의 경계를 명확히 표시
  - 재접기: **fold bar 클릭** 또는 **vim normal 모드에서 커서가 fold zone을 벗어나면 자동 재접기** (visual 모드에서는 셀 선택 유지를 위해 자동 재접기 안 함)
- **자정 넘김 블록:** 자정을 기준으로 분할되므로, 접기 영역에 걸치는 블록은 분할된 부분만 숨겨진 블록 카운트에 반영

### 8. Vim Keyboard Mode

nvim 스타일의 모달 키보드 시스템으로, 마우스 없이 타임라인을 네비게이션하고 블록을 조작할 수 있다. 설정의 `Vim Mode`로 켜고 끌 수 있으며, 모바일에서는 자동 비활성.

#### 모드

| 모드 | 진입 | 역할 |
|------|------|------|
| **Normal** | Esc, 뷰 포커스 시 기본 | 이동·조작·명령 |
| **Insert** | i, o, O, Enter | 인라인 에디터/편집 모달 활성화 |
| **Visual** | v, V | 셀 범위 선택 (블록 생성·일괄 삭제) |

하단에 모드 인디케이터 표시:

- **Normal (빈 칸)**: `-- NORMAL -- 14:30`
- **Normal (블록 위)**: `-- NORMAL -- 14:30 ▸ [14:00–14:30] 회의 준비` — 커서가 블록 위에 있으면 시간 범위와 content를 함께 표시 (길면 ellipsis로 생략)
- **Visual**: `-- VISUAL -- 14:00 → 15:30 (1h 30m)` — duration은 `Xh Ym` 형식 (소수점 없음)
- **Insert**: `-- INSERT --`

#### 커서 모델

- **커서 = 그리드 서브슬롯 위치** (dayIndex + minutes, 10분 단위 snap)
- 커서 위치에 `border: 2px solid var(--interactive-accent)` + 펄스 애니메이션 표시
- 마우스 클릭 시 해당 셀에 커서 동기화
- 커서가 뷰포트 밖으로 이동하면 sticky 헤더 높이를 고려한 자동 스크롤
- **Visible range 제한:** h/l, j/k 이동은 현재 보이는 요일 범위(1일/3일/7일뷰) 내로 제한. H/L은 범위 밖 이동 시 뷰 시점(dayOffset)을 함께 이동하고, 주 경계에서는 이전/다음 주로 전환
- 커서가 접힌(folded) 시간대에 진입하면 자동 언폴딩, 커서가 fold zone을 벗어나면 자동 재접기 (normal 모드만 — visual 모드에서는 선택 유지를 위해 재접기 안 함)

#### Scope 격리

Obsidian `Scope` API (`View.scope`)를 사용하여 **WeekFlow 뷰에 포커스가 있을 때만** 키 바인딩 활성화. 모달이 열리면 모달의 Scope가 우선하므로 vim 키 비활성화. Insert 모드에서는 `<input>` 포커스로 자동 격리.

#### 키맵 (Normal)

| 키 | 동작 |
|---|---|
| h / l | 10분 가로 이동 — 시간 행 경계에서 인접 요일로 래핑, visible range 내로 제한 |
| j / k | 1시간 세로 이동 (같은 요일, 행 단위) |
| H / L | 이전/다음 요일 — visible range 밖이면 뷰 시점 이동, 주 경계 시 이전/다음 주로 전환 |
| 0 | 현재 시간 행 시작 (XX:00) |
| $ | 현재 시간 행 끝 (XX:50) |
| gg | dayStartHour로 점프 |
| G | dayEndHour로 점프 |
| gt | 현재 시각+오늘로 점프 — 다른 주를 보고 있으면 이번 주로 전환, 뷰 시점도 오늘로 이동 |
| i / Enter | 블록 위: 인라인 에디터 (기존 content/tag 프리필, Enter로 저장). 빈 칸: 새 블록 인라인 에디터. `Tab`으로 풀 모달(`EditBlockModal`/`BlockModal`) 승격. Esc/Enter로 나가면 자동 Normal 복귀 |
| o / O | 커서 아래/위에 새 블록 + Insert |
| dd | 블록 삭제 (undo toast) |
| cd | 블록을 다음 날로 defer (과거 날짜 plan은 `[>]` deferred 처리) |
| ct | 태그 변경 팝업 (j/k 선택, Enter 확정, Esc 취소) |
| cs | 블록 시작 시간 변경 서브모드 진입 (아래 참조) |
| ce | 블록 끝 시간 변경 서브모드 진입 (아래 참조) |
| x | 완료 토글 (plan ↔ actual) |
| < / > | 블록 시작시간 ±10분 이동 |
| + / - | 블록 길이 ±10분 증감 |
| u | undo |
| Ctrl+r | redo |
| zi | Planning(Inbox) 패널 토글 |
| zr | Review 패널 토글 — 강제 review 모드 (열림+review → 닫기, 열림+log → review로 전환, 닫힘 → review로 열기) |
| zl | Log 패널 토글 — 강제 log 모드 (열림+log → 닫기, 열림+review → log로 전환, 닫힘 → log로 열기) |
| v | Visual 모드 진입 (커서 위치에서) |
| V | Visual Line 모드 — 현재 시간 행 전체 선택 (XX:00~XX:50) |
| ? | 단축키 도움말 모달 |
| Esc | pending 취소, 선택 해제 |

#### 키맵 (Visual)

| 키 | 동작 |
|---|---|
| h / l / j / k | 선택 범위 확장/축소 |
| Enter | 선택 범위로 블록 생성 → Insert |
| dd | 범위 내 블록 삭제 |
| Esc | 취소, Normal 복귀 |

#### 시간 변경 서브모드 (cs/ce)

`cs` (change start) 또는 `ce` (change end) 진입 시, 블록의 시작/끝 시간을 숫자 입력 또는 네비게이션으로 변경. ghost preview로 변경될 시간을 표시하고, 확정 시에만 저장.

**숫자 입력:**
- **2자리** (예: `30`) → 현재 시간 행의 분으로 해석 (300ms 대기 후 확정). 정각(XX:00)에 위치한 끝 시간은 이전 시간 행 기준으로 해석
- **4자리** (예: `0930`) → HHMM으로 즉시 확정
- **`60`** → 다음 시 정각 (시간 행 오른쪽 끝)

**네비게이션:**

| 키 | 동작 |
|---|---|
| h / l | ±10분 |
| H / L (Shift) | ±1분 (미세 조정) |
| j / k | ±60분 |
| $ | 다음 시 정각 |
| Enter | 확정 |
| Esc | 취소 (원래 시간으로 복원) |

유효성 검사: start ≥ end이면 적용 거부, 원래 값 유지.

#### Multi-key 시퀀스

`gg`, `dd`, `cd`, `ct`, `cs`, `ce`, `gt`, `zi`, `zr`, `zl`은 pending key 버퍼(1초 타임아웃)로 처리. 첫 키 입력 후 1초 내에 두 번째 키가 오면 시퀀스 실행, 아니면 버퍼 클리어.

## CLI Integration

Obsidian CLI (1.12.2+)의 네이티브 플러그인 CLI 핸들러를 통해 외부 에이전트 및 스크립트에서 WeekFlow 데이터에 접근하고 조작할 수 있다.

### 목적

- **외부 에이전트 연계:** cete-os 등 에이전트 시스템에서 주간 다이제스트 조회, 인박스 추가, 일정 배치 등을 자동화
- **스크립팅:** 터미널에서 빠른 데이터 조회 및 조작
- **MCP/CLI 파이프라인:** 에이전트가 조회 → 판단 → 조작을 연쇄적으로 수행

### 응답 포맷

모든 커맨드는 JSON 문자열을 반환한다:

```json
// 성공
{ "ok": true, "command": "weekflow:today", "data": { ... } }

// 에러
{ "ok": false, "command": "weekflow:add", "error": "Missing required flag(s): date" }
```

### 항목 식별 방식

타임라인 항목은 런타임 `id`가 아닌 **date + index** 조합으로 식별한다:

1. 조회 커맨드(`weekflow:today`, `weekflow:digest` 등) 결과의 각 항목에 `index`가 포함됨
2. `index`는 데일리 노트 Timeline 섹션 내 파싱 순서 (0-based)
3. 변경 커맨드(`weekflow:complete`, `weekflow:delete` 등)에서 `date` + `index`로 항목 특정
4. `index`는 쉼표로 구분하여 복수 지정 가능 — 내부에서 역순 처리하므로 인덱스 밀림 없음

```bash
# 1. 조회하여 index 확인
obsidian weekflow:today
# → { "data": { "items": [{ "index": 0, "content": "코드리뷰", ... }, ...] } }

# 2. 단일 index로 조작
obsidian weekflow:complete date=2026-04-10 index=0

# 3. 복수 index로 배치 조작 (인덱스 밀림 걱정 없음)
obsidian weekflow:delete date=2026-04-10 index=1,2,3
# → 단일: { "removed": { ... } }  /  복수: { "removed": [{ ... }, ...] }
```

### Read 커맨드

| 커맨드 | 플래그 | 설명 |
|--------|--------|------|
| `weekflow` | `from`, `to` | 이번 주 다이제스트 (일별 항목 + 통계 + 리뷰) |
| `weekflow:today` | — | 오늘 타임라인 항목 |
| `weekflow:digest` | `from`\*, `to`\*, `include-review` | 임의 기간 다이제스트 |
| `weekflow:inbox` | — | 인박스 전체 목록 (index 포함) |
| `weekflow:stats` | `from`, `to` | 카테고리/프로젝트별 시간 통계 |
| `weekflow:projects` | — | 활성 프로젝트 + 미완 태스크 목록 |
| `weekflow:review` | `date` | 특정 날 리뷰 텍스트 조회 |
| `weekflow:weekly-review` | `date` | 주간 노트 리뷰 텍스트 조회 (해당 주의 아무 날짜) |
| `weekflow:log` | `date` | 특정 날 로그 항목 조회 (기본: 오늘) |
| `weekflow:settings` | — | 플러그인 설정 전체 조회 (weekStartDay, 경로, 카테고리 등) |

\* = required

### Write 커맨드

| 커맨드 | 플래그 | 설명 |
|--------|--------|------|
| `weekflow:add` | `date`\*, `start`\*, `end`\*, `content`\*, `tags`, `type` | 타임라인 블록 생성 |
| `weekflow:complete` | `date`\*, `index`\*, `actual-start`, `actual-end` | 블록 완료(actual) 처리. 배치 시 `actual-*` 사용 불가 |
| `weekflow:defer` | `date`\*, `index`\*, `to`\* | 블록 다른 날로 연기 |
| `weekflow:delete` | `date`\*, `index`\* | 블록 삭제 |
| `weekflow:inbox:add` | `content`\*, `tags` | 인박스에 항목 추가 |
| `weekflow:inbox:remove` | `index`\* | 인박스 항목 삭제 |
| `weekflow:review:write` | `date`\*, `text`\* | 리뷰 텍스트 저장 |
| `weekflow:weekly-review:write` | `date`\*, `text`\* | 주간 노트 리뷰 텍스트 저장 |
| `weekflow:log:add` | `content`\*, `date`, `time` | 로그 항목 추가 (기본: 오늘, 현재 시각) |
| `weekflow:log:delete` | `date`\*, `index`\* | 로그 항목 삭제 |

`index`는 단일(`index=0`) 또는 쉼표 구분 복수(`index=0,2,3`) 모두 지원.
복수일 때 내부에서 역순 처리하여 인덱스 밀림 방지. 단일이면 기존과 동일한 응답, 복수이면 배열로 반환.

\* = required

#### 로그 CLI 특이사항

- **정렬 순서가 `index`의 기준:** `weekflow:log`는 로그를 `timeMinutes` 오름차순으로 정렬한 뒤 `index`를 부여한다. `weekflow:log:delete`도 같은 정렬 후 인덱스를 기준으로 삭제한다 — 파일 내 작성 순서와 섞여도 일관된 식별이 보장된다.
- **`time` 플래그 포맷:** `weekflow:log:add`의 `time`은 항상 `HH:MM`(24시간제)로 입력한다. 설정의 `Log timestamp format`과 무관하게 CLI 입력 포맷은 고정 — 에이전트가 포맷을 추측할 필요가 없다. 저장 시에는 설정된 포맷으로 직렬화된다.
- **응답 아이템 형태:**
  ```json
  {
    "index": 2,
    "time": "14:32",
    "timeMinutes": 872,
    "content": "PR 리뷰 완료"
  }
  ```
  `time`은 설정된 포맷으로 표시되고, `timeMinutes`는 자정 기준 분으로 가공 없이 제공된다.

### Digest 데이터 구조

`weekflow` 및 `weekflow:digest`가 반환하는 다이제스트 포맷:

```json
{
  "period": { "start": "2026-04-06", "end": "2026-04-12" },
  "daily": [
    {
      "date": "2026-04-06",
      "weekday": "Mon",
      "items": [
        {
          "index": 0,
          "content": "팀 미팅",
          "tags": ["work"],
          "type": "actual",
          "planTime": { "start": "09:00", "end": "10:00", "minutes": 60 },
          "actualTime": { "start": "09:00", "end": "10:30", "minutes": 90 }
        }
      ],
      "review": "오늘은 집중이 잘 됐다.",
      "summary": {
        "planMinutes": 480,
        "actualMinutes": 420,
        "planCount": 6,
        "actualCount": 5,
        "deferredCount": 1
      }
    }
  ],
  "stats": {
    "totalPlanMinutes": 2400,
    "totalActualMinutes": 2100,
    "completionRate": 80,
    "deferredRate": 10,
    "totalPlanItems": 30,
    "completedItems": 24,
    "deferredItems": 3,
    "categoryBreakdown": [
      { "tag": "work", "label": "Work", "planMinutes": 1800, "actualMinutes": 1600, "achievementRate": 89 }
    ],
    "projectBreakdown": [
      { "name": "ProjectA", "planMinutes": 300, "actualMinutes": 250 }
    ]
  }
}
```

### 에이전트 연계 시나리오

```bash
# 오늘 일정 파악 → AI 브리핑
obsidian weekflow:today

# 캘린더 이벤트 기반으로 타임라인 자동 배치
obsidian weekflow:add date=2026-04-10 start=14:00 end=15:30 content="팀 미팅" tags=work

# 빠른 캡처
obsidian weekflow:inbox:add content="API 문서 검토" tags=work

# 주간 회고 AI 생성
obsidian weekflow:digest from=2026-04-06 to=2026-04-12
# → 에이전트가 다이제스트 분석 후 회고 작성
obsidian weekflow:review:write date=2026-04-12 text="이번 주 요약: ..."
```

### 아키텍처

```
src/cli/
├── index.ts              # registerAllCliHandlers() — main.ts에서 호출
├── handlers-read.ts      # 조회 핸들러 (10개)
├── handlers-write.ts     # 변경 핸들러 (10개)
└── response.ts           # JSON 응답 유틸 (ok/err)
src/digest.ts             # 데이터 정제 (TimelineItem → DigestItem)
```

- 모든 핸들러는 headless (vault + settings만 사용, UI 비의존)
- `registerCliHandler`가 없는 구버전에서는 자동 스킵
- 기존 `daily-note.ts`, `parser.ts`, `statistics.ts`의 함수를 재활용

## Technical Notes

- Obsidian Plugin API 사용
- `ItemView`를 확장한 커스텀 뷰로 타임테이블 렌더링
- 데이터는 데일리 노트 헤딩 아래 마크다운 리스트로 저장 (이식성 보장)
- `workspace.on('active-leaf-change')` 등으로 포커스 시점에 데이터 갱신
- 마크다운 헤딩+리스트 파서를 자체 구현하여 데이터 읽기/쓰기
- 반응형 레이아웃: 뷰 너비 기반 3-tier (`wide` ≥900px / `medium` ≥500px / `narrow` <500px). `ResizeObserver`로 `.weekflow-container` 너비를 실시간 감시하여 데스크톱 창 리사이즈, iPad Split View, 오리엔테이션 전환에 자동 대응. `src/device.ts`의 `getLayoutTier()`/`getVisibleDays()` 유틸리티로 결정
- Pointer Events API: 모든 인터랙션을 `pointerdown`/`pointermove`/`pointerup`으로 통합 (마우스+터치+펜). `setPointerCapture()`로 리사이즈 드래그 안정화. 터치에서는 선택 모드 → 이동 모드 진입 방식으로 드래그 시작 (롱프레스 미사용). Apple Pencil(`pointerType === "pen"`)은 마우스 경로로 처리 (직접 드래그/리사이즈, 호버 시 툴팁만)
- Statistics Panel에서 장기 범위(분기/연간) 조회 시 다수의 데일리 노트를 읽어야 하므로, 파싱 결과를 캐싱하고 변경된 파일만 재파싱하는 증분 처리(incremental parsing) 방식을 적용한다

## 구현 상태 (2026-02-22)

### 완료

Phase 1~6의 모든 기능이 구현 완료되었다.

### 보류 / 제외

| 항목 | 원래 위치 | 사유 | 대안 |
|------|-----------|------|------|
| 대각선 셀 클릭으로 5분 단위 선택 | Phase 2 (5분 단위 지원) | 셀 크기가 작아 정밀 클릭이 어렵고 UX가 번잡해짐 | EditBlockModal에서 `<input type="time" step="300">`으로 5분 단위 입력 가능 |
| Statistics를 같은 뷰 내 탭으로 리팩토링 | Phase 4 (통계) | 현재 별도 ItemView 탭으로 기능적으로 완전함. UX 개선 수준 | `weekflow-stats-view` 별도 탭으로 접근 (커맨드 팔레트 또는 툴바 버튼) |
