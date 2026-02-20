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
- **5분 단위 지원:** 데이터 기록 시 시간은 5분 단위로 저장된다 (e.g., `09:05-09:55`). EditBlockModal에서 5분 단위 입력이 가능하며, 5분 단위 블록은 대각선 clip-path로 시각적으로 구분된다.

### Cell States

각 셀은 체크박스 상태와 시간 표기 형식의 조합으로 결정된다.

| 상태 | 마크다운 형식 | 시각적 표현 | 설명 |
|------|-------------|------------|------|
| Empty | — | 빈 셀 | 아무 할당 없음 |
| Plan only | `- [ ] 09:00-11:00 내용 #tag` | 테두리(outline) | 계획만 있음 (미실행) |
| Plan = Actual | `- [x] 09:00-11:00 내용 #tag` | 채우기(fill) | 계획대로 실행됨 |
| Plan ≠ Actual | `- [x] 09:00-11:00 > 09:00-10:30 내용 #tag` | 채우기(fill) + 테두리(outline) | 계획과 실행 시간이 다름 |
| Deferred | `- [>] 09:00-11:00 내용 #tag` | 파선 테두리(dashed) + 반투명(50%) | 다른 날로 미룸 |

## Interaction

### 시간 블록 할당

**데스크톱 (마우스):**
1. **클릭:** 단일 셀 선택 → 모달
2. **드래그:** 연속된 셀 범위 선택 (같은 날 내) → 모달
3. 셀 선택 후 블록 생성 모달에서 시간/내용/카테고리를 지정하여 블록 생성 (시간은 드래그 범위로 초기화되며 모달에서 수정 가능, 날짜에 따라 Plan/Actual 자동 결정)

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
- **블록 완료 토글:** Plan 블록에 표시되는 ○ 버튼을 클릭하면 `- [x]` (Actual)로 변환. Actual 블록의 ✓ 버튼을 클릭하면 `- [ ]` (Plan)으로 되돌림. 토글 버튼은 블록의 마지막 세그먼트(여러 행에 걸치는 경우 마지막 행) 우측 상단에 표시된다.
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
  - **Delete** — 블록 삭제 (Undo 가능)
- 블록 경계를 드래그하여 시간 범위 조정 (리사이즈)
  - Actual 블록 리사이즈 시 actualTime만 변경, planTime은 보존
- 블록을 드래그하여 다른 시간대/요일로 이동 (같은 주 내)
  - 다른 요일로 이동 시 해당 날짜의 데일리 노트로 데이터가 옮겨짐
  - Actual 블록 이동 시 actualTime만 변경, planTime은 보존

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

### 기본 제공 카테고리 (예시)

| Tag | Label | Color |
|-----|-------|-------|
| `#work` | 업무 | `#4A90D9` (파랑) |
| `#study` | 학업 | `#7ED321` (초록) |
| `#exercise` | 운동 | `#F5A623` (주황) |
| `#rest` | 휴식 | `#9B9B9B` (회색) |
| `#personal` | 개인 | `#BD10E0` (보라) |

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
   - **폴더 소스:** 하위 `.md` 파일을 재귀적으로 스캔하여 미완료 체크박스 읽기. 읽기 전용 (쓰기 불가).
   - **새 항목 추가:** 소스 목록의 순서(우선순위)에서 첫 번째 노트 소스(폴더 소스 제외)에 기록. 노트 소스가 없으면 추가 버튼 미표시.
3. **📁 프로젝트별 태스크:** 설정에 지정된 조건에 맞는 활성 프로젝트의 태스크 헤딩에서 미완료 태스크. *(현재 비활성화 — 프로젝트 기능 강화 후 재활성화 예정)*

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
- 인박스 패널에서 **새 항목 직접 추가** 가능 (우선순위 1위 노트 소스에 기록, 노트 소스가 없으면 미표시)

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
| Timeline Heading | 타임라인 데이터가 위치할 헤딩 | `## Timeline` | 1 |
| Day Start Hour | 테이블 시작 시간 | `6` (06:00) | 1 |
| Day End Hour | 테이블 종료 시간 | `24` (00:00) | 1 |
| Week Start Day | 주 시작 요일 | `Monday` | 1 |
| Categories | 카테고리 목록 관리 | 기본 2개 (Work, Personal) | 1 |
| Inbox Sources | 인박스 소스 목록 (경로 + 선택적 헤딩, 순서=우선순위) | `[{path: "Inbox.md", heading: ""}]` | 3 |
| Default Block Duration | 패널에서 드래그 시 기본 블록 길이 (분) | `60` | 3 |
| Planning Panel Open | 패널 열림/닫힘 상태 유지 | `true` | 3 |
| Project Tag | 프로젝트 노트를 식별하는 태그 | `type/project` | 3 |
| Project Status Field | 프로젝트 상태를 나타내는 frontmatter 필드 | `status` | 3 |
| Project Active Statuses | 활성으로 간주할 상태 값 목록 (쉼표 구분) | `🟡 In Progress, 🔴 Urgent` | 3 |
| Project Tasks Heading | 프로젝트 내 태스크가 위치할 헤딩 | `## Tasks` | 3 |
| Presets | 타임 슬롯 프리셋 목록 | (빈 목록) | 3 |
| Review Heading | 회고 데이터가 위치할 헤딩 | `## Review` | 4 |
| Review Panel Open | 리뷰 패널 열림/닫힘 상태 유지 | `true` | 4 |
| Review Panel Height | 리뷰 패널 높이 (px, 드래그 리사이즈) | `160` | 4 |
| Calendar Sources | 외부 캘린더 ICS URL 목록 | (빈 목록) | 5 |
| Calendar Cache Duration | 캘린더 캐시 갱신 간격 (분) | `30` | 5 |

#### Inbox Source 구조

```typescript
interface InboxSource {
  path: string;    // 노트 경로 (e.g., "Inbox.md") 또는 폴더 경로 (e.g., "Projects/Active")
  heading: string; // 읽기/쓰기 범위를 제한할 헤딩; 빈 문자열 = 노트 전체
}
```

- 소스 타입(Note/Folder)은 경로가 볼트 내 폴더인지 자동 감지하여 결정
- 순서가 우선순위: 배열의 첫 번째 노트 소스(폴더 제외)가 우선순위 1위 (새 항목 기록 대상)
- 설정 UI에서 드래그로 순서 변경 가능

#### 자동 마이그레이션

플러그인 로드 시 이전 버전의 `inboxNotePath`/`inboxHeading` 설정이 있고 `inboxSources`가 없으면, 기존 값을 `inboxSources` 배열로 자동 변환한다. moment.js 동적 경로(`inboxNotePath`)는 현재 날짜 기준으로 해석하여 정적 경로로 변환한 후 마이그레이션하며, 이전 속성은 삭제된다.

#### 경로 미리보기

경로 패턴에 moment.js 토큰이 포함된 경우, 설정 화면에서 현재 날짜 기준으로 실제 파일 경로를 미리보기로 표시한다. 사용자가 패턴을 올바르게 지정했는지 즉시 확인할 수 있다.

```
Daily Note Path:  [5. Periodic Notes/YYYY/MM/YYYY-MM-DD  ]
  📄 Preview: 5. Periodic Notes/2026/02/2026-02-06.md

Inbox Sources:                           (≡ 드래그로 순서 변경)
  [≡] [Inbox.md              ] [### To Do ] [Note]   [✕]
  [≡] [Work/Tasks.md         ] [## Inbox  ] [Note]   [✕]
  [≡] [Projects/Active       ] [          ] [Folder] [✕]
                                              [+ Add Source]
```

## UI Components

### 1. Timetable View (Main)

- Obsidian 커스텀 뷰(Leaf)로 표시되는 메인 타임테이블
- 상단 툴바 (2줄 구성):
  - **Row 1:** 패널 토글 | ◀ 주차·날짜 표시 ▶ | Today | 도구 버튼(↻ ↩ ↪ Presets Stats Review) + 오버플로 `⋯` 메뉴. 주차 라벨 클릭 시 뷰 모드 메뉴(7d/3d/1d/Auto) 표시. 오늘이 현재 뷰 범위 밖일 때 오늘 방향의 ◀/▶ 및 Today 버튼 하단에 accent 색상 dot 힌트 표시
  - **Row 2:** 카테고리 팔레트 (가로 스크롤)
- ◀/▶ 버튼은 뷰 모드에 따라 역할 변경: 7일 뷰=주 이동, 3일 뷰=2일 단위 페이지 이동, 1일 뷰=1일 이동
- 도구 버튼이 공간 부족 시 `⋯` 오버플로 메뉴(Obsidian `Menu`)로 접근 가능
- 본문: Planning Panel(좌측) + 7일 x 시간대 그리드 + Daily Review Panel(하단)
- **Navigate to Source (데스크톱 전용, `@media (pointer: fine)`):**
  - **블록:** hover 시 우측 하단에 `arrow-up-right` 아이콘 표시 → 클릭 시 데일리 노트의 해당 라인으로 이동. 우클릭 메뉴에도 "Go to daily note" 항목 제공
  - **패널 아이템 (인박스/오버듀):** hover 시 우측에 `arrow-up-right` 아이콘 표시 → 인박스는 소스 노트, 오버듀는 데일리 노트로 이동. 우클릭 메뉴에도 동일 항목 제공

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

### 4. Daily Review Panel

타임테이블 하단에 7일분의 회고 패널을 나란히 배치한다. 계획(Plan) → 실행(Actual) → 회고(Review)의 사이클을 시각적으로 완성하는 영역.

```
┌─────────────────── Weekly Timetable ───────────────────┐
│  Mon   Tue   Wed   Thu   Fri   Sat   Sun               │
│  ...   ...   ...   ...   ...   ...   ...               │
├─────────────────── Daily Review ───────────────────────┤
│ Mon    │ Tue    │ Wed    │ Thu    │ Fri    │ Sat  │ Sun │
│ 오늘은 │ 집중이 │        │        │        │      │     │
│ 설계에 │ 잘 안  │        │        │        │      │     │
│ 몰입.. │ 됐다.. │        │        │        │      │     │
└────────┴────────┴────────┴────────┴────────┴──────┴─────┘
```

- 각 칸은 해당 데일리 노트의 회고 헤딩(설정의 Review Heading) 아래 내용을 표시
- WeekFlow 뷰에서 직접 편집 가능 → 데일리 노트에 즉시 반영
- 회고 헤딩이 없는 노트는 빈 칸으로 표시하되, 클릭 시 헤딩을 자동 추가하고 편집 시작

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

- **계획 이행률:** 계획한 항목 중 실행 완료된 비율
- **미루기 비율:** `- [>]` deferred 항목의 비율
- **비계획 실행:** 계획 없이 `- [x]`로 바로 생성된 항목의 비율

## Responsive UI & Mobile

모바일(Obsidian Mobile)과 다양한 화면 크기에서 동일한 기능을 반응형 UI로 제공한다. **디바이스 타입이 아닌 가용 너비(available width)를 기준으로** 레이아웃을 결정하며, `ResizeObserver`로 실시간 감시하여 데스크톱 창 리사이즈, Split View, 오리엔테이션 전환 모두 하나의 로직으로 처리한다.

### 레이아웃 브레이크포인트 (너비 기반)

| 뷰 너비 | Layout Tier | 표시 일수 | Planning Panel | Review Panel |
|---------|-------------|----------|----------------|--------------|
| **≥ 900px** | `wide` | 7일 | 사이드 패널 | 7칸 |
| **500~899px** | `medium` | 3일 | 사이드 패널 (220px, 접힘 가능) | 표시 일수만큼 |
| **< 500px** | `narrow` | 1일 | 하단 시트 (bottom sheet) | 1칸 |

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
- 터치 디바이스에서 블록 드래그는 롱프레스(300ms) 후 시작, `weekflow-longpress-active` 클래스로 scale+shadow 시각 피드백 + 햅틱 진동
- 데스크톱 블록 드래그는 150ms 딜레이 후 시작
- **블록 툴팁:** 작은 블록에서 잘리는 타이틀을 확인할 수 있는 커스텀 툴팁. 시간과 내용을 `HH:MM-HH:MM content` 형식으로 표시. 입력 방식별 트리거:
  - **마우스/Apple Pencil:** `pointerenter` 후 300ms 딜레이로 표시, `pointerleave` 시 즉시 숨김
  - **터치(손가락):** 롱프레스(300ms) 시 드래그 진입과 함께 표시, 드래그 이동 또는 pointerup 시 숨김
  - 툴팁은 블록 상단에 `position: fixed`로 배치되며, 뷰포트 경계 클램핑 적용 (상단 넘침 시 블록 하단으로 전환)

### 스와이프 네비게이션

빈 셀 영역에서의 가로 스와이프를 감지하여 날짜/주 이동:

- **감지 기준:** 가로 이동 >50px, |가로| > |세로|*2, 시간 <300ms
- **감지 시점:** `pointerup` 및 `pointercancel` 모두에서 판정 (브라우저가 세로 스크롤로 인해 `pointercancel`을 발생시켜도 수평 스와이프 데이터를 활용)
- **Obsidian 사이드바 차단:** 그리드에 `touchstart`/`touchmove` 리스너로 수평 이동 >15px 감지 시 `stopPropagation()` 호출
- **Wide + 터치:** 스와이프 → 주 이동
- **Medium (3일):** 스와이프 → dayOffset ±2 (고정 페이지 [0,2,4], 주 경계 넘으면 주 이동)
- **Narrow (1일):** 스와이프 → dayOffset ±1 (주 경계 넘으면 주 이동)
- **7일 뷰 + 데스크톱:** 제스처 스와이프 비활성화 (마우스 드래그와 충돌 방지). 단, ◀/▶ 버튼은 동작. override로 3일 뷰를 넓은 화면에서 사용할 때는 스와이프 동작

### 하단 시트 (Narrow 모드 Planning Panel)

Narrow 모드에서 사이드 패널 대신 하단 시트로 표시:

- `collapsed` 상태: 핸들 바만 표시 (~40px)
- `expanded` 상태: 최대 60vh
- 핸들 스와이프 업/다운 또는 탭으로 토글
- 툴바의 패널 토글 버튼도 하단 시트를 제어 (Wide/Medium에서는 사이드 패널, Narrow에서는 하단 시트)
- 내부에 PlanningPanel 컴포넌트를 재사용

### dayOffset 로직

- **7일 (wide):** offset=0 (월~일 전부 표시)
- **3일 (medium):** 고정 페이지 [0, 2, 4] — 1일 오버랩으로 주 전체 커버
  - 월화수(0) → 수목금(2) → 금토일(4)
  - Today 버튼: today가 포함되는 가장 앞 페이지 (과거 맥락 우선)
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

- **`.weekflow-grid`:** `touch-action: pan-y` — 세로 스크롤은 브라우저에 위임, 수평 제스처는 JS에서 처리 (스와이프 감지). Obsidian 사이드바 스와이프는 `touchmove` `stopPropagation()`으로 차단.
- **`.weekflow-block`, `.weekflow-resize-handle`, `.weekflow-panel-item`, `.weekflow-review-resize-handle`, `.weekflow-bottom-sheet-handle`:** `touch-action: none` — 드래그 가능 요소에서 브라우저 기본 제스처 완전 차단.
- **`.weekflow-cell`:** 부모(`.weekflow-grid`)의 `pan-y`를 상속 — 셀 위에서 세로 스크롤 허용.

#### 터치 타겟 (`.is-mobile`)

- 툴바 버튼: min-width/height 36px
- 패널 아이템: padding 10px 12px, min-height 44px
- 블록 토글 버튼: 28px×28px
- 오버랩 핸들: 16px×16px

#### Statistics 반응형

`@media (max-width: 600px)`: 헤더 세로 배치, 요약 카드 1열, 차트 세로 배치

### 오리엔테이션 전환

별도의 `orientationchange` 이벤트 리스너 불필요. `ResizeObserver`가 뷰 너비 변경을 즉시 감지하여 브레이크포인트를 재평가한다.

| 디바이스 | 세로(Portrait) | 가로(Landscape) |
|---------|---------------|----------------|
| **iPhone** | Narrow (1일) | Medium (3일) |
| **iPad** | Wide (7일) | Wide (7일) |
| **iPad Split View** | Medium (3일) | Wide or Medium |
| **Desktop 좁은 창** | Medium 또는 Narrow | — |

### 모바일 전용 고려사항

- **스크롤 충돌 방지:** 그리드와 블록 모두 `touch-action: pan-y`로 세로 스크롤 허용, 터치 셀 선택은 탭-탭 방식으로 드래그와 분리. 블록 터치 시 `preventDefault()` 미호출로 스크롤 유지, 롱프레스 시 `setPointerCapture()`로 드래그 전환. 리사이즈 핸들은 `touch-action: none`.
- **햅틱 피드백:** 롱프레스 드래그 시작 시 `navigator.vibrate(10)` 호출.
- **오프라인 동작:** 데이터가 로컬 마크다운 파일이므로 오프라인에서도 완전히 동작. 캘린더 오버레이만 캐시 기반으로 제한적 표시.
- **Split View / Stage Manager (iPad):** `ResizeObserver`로 실제 뷰 영역 크기를 감시하여 레이아웃을 동적으로 적응. 디바이스 타입이 아닌 실제 가용 너비를 기준으로 컬럼 수를 결정하므로, Stage Manager에서 창 크기를 자유롭게 변경해도 자연스럽게 대응.

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
- 블록 우클릭 컨텍스트 메뉴: Edit / Mark as Done(or Incomplete) / Delete. Obsidian 네이티브 `Menu` 사용.
- EditBlockModal 완료 토글: Plan 블록에 "Mark as Done", Actual 블록에 "Mark as Incomplete" 버튼. Deferred 블록 미표시.

**이 Phase가 끝나면:** 타임테이블에서 블록을 자유롭게 드래그하고 편집할 수 있고, 데일리 노트와 실시간으로 연동된다.

### Phase 3 — 플래닝 워크플로우 ✅

**목표:** 할 일을 모아보고, 시간에 배치하고, 미완료 항목을 관리하는 플래닝 사이클.

- Planning Panel (사이드바, 토글 가능)
- 인박스 연동: 등록된 인박스 소스(노트/폴더)에서 미완료 체크박스 수집 (헤딩 있으면 해당 섹션만, 없으면 전체, 폴더는 재귀 스캔)
- 인박스 패널에서 새 항목 직접 추가 (우선순위 1위 노트 소스에 기록)
- 설정: Inbox Sources (경로 + 선택적 헤딩, 드래그로 순서=우선순위 변경), Default Block Duration
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
- 롱프레스 드래그 (터치 300ms, 마우스 150ms) + 시각 피드백 (`weekflow-longpress-active`) + 햅틱
- Narrow 모드: 하단 시트 Planning Panel (collapsed/expanded, 스와이프 핸들, 툴바 패널 토글과 연동)
- 툴바 2줄 구조: Row 1 (nav + tools + `⋯` 오버플로 메뉴), Row 2 (카테고리 팔레트, 가로 스크롤). ◀/▶ 버튼이 뷰 모드별 역할 변경
- `@media (pointer: fine)`: hover 효과를 마우스 전용으로 격리
- `@media (pointer: coarse)`: 항상 표시 토글/리사이즈 핸들, 터치 타겟 보장
- `.weekflow-grid`와 `.weekflow-block`에 `touch-action: pan-y` (세로 스크롤 허용), 리사이즈 핸들은 `touch-action: none`
- 모바일 하단 네비 바 대응: `.is-mobile .weekflow-container`에 `env(safe-area-inset-bottom)`, `.is-mobile .weekflow-grid-wrapper`에 `padding-bottom: 48px`
- 모바일 바텀 시트 오프셋: `.is-mobile .weekflow-bottom-sheet { bottom: 48px }` (네비 바 위로 배치), narrow+mobile 그리드 패딩 96px
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

- **표시 조건:** 오늘이 visible range에 포함되고, 현재 시간이 `dayStartHour`~`dayEndHour` 범위 내일 때만 표시
- **위치 계산:** `getCellFromPoint()`와 동일한 그리드 geometry 기반 — `position: absolute`로 gridEl 내에 배치
- **업데이트:** `setInterval(60000)`으로 매 분 위치 갱신. `render()` 시 이전 interval 정리 후 새로 생성
- **스타일:** 2px 빨간 수평선 (`#EA4335`) + 8px 원형 dot, `z-index: 15` (블록 위, 오버랩 핸들 아래)
- **반응형:** 7일/3일/1일 뷰 모드 전환 및 다른 주 이동 시 자동으로 표시/숨김

## Technical Notes

- Obsidian Plugin API 사용
- `ItemView`를 확장한 커스텀 뷰로 타임테이블 렌더링
- 데이터는 데일리 노트 헤딩 아래 마크다운 리스트로 저장 (이식성 보장)
- `workspace.on('active-leaf-change')` 등으로 포커스 시점에 데이터 갱신
- 마크다운 헤딩+리스트 파서를 자체 구현하여 데이터 읽기/쓰기
- 반응형 레이아웃: 뷰 너비 기반 3-tier (`wide` ≥900px / `medium` ≥500px / `narrow` <500px). `ResizeObserver`로 `.weekflow-container` 너비를 실시간 감시하여 데스크톱 창 리사이즈, iPad Split View, 오리엔테이션 전환에 자동 대응. `src/device.ts`의 `getLayoutTier()`/`getVisibleDays()` 유틸리티로 결정
- Pointer Events API: 모든 인터랙션을 `pointerdown`/`pointermove`/`pointerup`으로 통합 (마우스+터치+펜). `setPointerCapture()`로 리사이즈 드래그 안정화. 터치 디바이스에서는 롱프레스(300ms) 후 드래그 시작 + 햅틱 피드백
- Statistics Panel에서 장기 범위(분기/연간) 조회 시 다수의 데일리 노트를 읽어야 하므로, 파싱 결과를 캐싱하고 변경된 파일만 재파싱하는 증분 처리(incremental parsing) 방식을 적용한다

## 구현 상태 (2026-02-20)

### 완료

Phase 1~6의 모든 기능이 구현 완료되었다.

### 보류 / 제외

| 항목 | 원래 위치 | 사유 | 대안 |
|------|-----------|------|------|
| 대각선 셀 클릭으로 5분 단위 선택 | Phase 2 (5분 단위 지원) | 셀 크기가 작아 정밀 클릭이 어렵고 UX가 번잡해짐 | EditBlockModal에서 `<input type="time" step="300">`으로 5분 단위 입력 가능 |
| Statistics를 같은 뷰 내 탭으로 리팩토링 | Phase 4 (통계) | 현재 별도 ItemView 탭으로 기능적으로 완전함. UX 개선 수준 | `weekflow-stats-view` 별도 탭으로 접근 (커맨드 팔레트 또는 툴바 버튼) |
