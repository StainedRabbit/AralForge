# AralForge Custom Markdown Reference

This guide collects the custom Markdown formats currently used in AralForge: module outline import, lesson import, quiz question import, and the generated module Markdown export. The examples are text-only; image references and separate lesson asset files are omitted.

## 1. Markdown in lesson text

Lesson text fields support the following rendered Markdown:

````md
# Heading 1
## Heading 2
### Heading 3
#### Heading 4

Regular paragraph text. Use **bold**, *italic*, `inline code`, or [a link](https://example.com).

- First bullet
- Second bullet

1. First step
2. Second step

| Term | Meaning |
|---|---|
| Input | Data a program receives |
| Output | The result a program produces |

```java
System.out.println("Hello, AralForge!");
```
````

The lesson text renderer supports headings through level 4, paragraphs, bullet and numbered lists, tables, inline bold/italic/code/links, and fenced code blocks. The fenced example above is suitable for lesson text fields.

## 2. Module outline import

Use a `#` heading for the module title, then a `##` heading for each topic. Topic-only outlines are valid. Optional topic metadata includes `Competency Code` (or `Code`), `Unit`, and `Overview`.

### Topics only

````md
# Introduction to Programming

## Topic 1: Input, Process, Output
Competency Code: CS11-IPO-001
Unit: Programming Basics
Overview: Students describe how programs receive input, process data, and produce output.

## Topic 2: Control Structures
Competency Code: CS11-CTRL-001
Unit: Program Flow
Overview: Students use decisions and repetition to control program behavior.
````

### Topics and lesson shells

Add lesson titles as bullets under each topic. Import creates blank lesson shells; it does not import lesson content.

```md
# Introduction to Programming

## Topic 1: Input, Process, Output
Competency Code: CS11-IPO-001
Unit: Programming Basics
Overview: Students describe how programs receive input, process data, and produce output.

- Lesson 1: IPO Model
- Lesson 2: Variables and Values

## Topic 2: Control Structures
Competency Code: CS11-CTRL-001
Unit: Program Flow
Overview: Students use decisions and repetition to control program behavior.

- Lesson 1: If Statements
- Lesson 2: Loops
```

The importer also recognizes `Unit` instead of `Topic` in headings. It accepts numbered or unnumbered topic and lesson titles. Other outline lines are ignored and shown as warnings in the preview.

## 3. Lesson Markdown import

Start with a lesson title, then optional order and publication metadata. Use the section headings below for the current student-facing lesson fields.

```md
# Lesson: Flowchart Symbols And Program Logic
Order: 1
Published: false

## What We'll Learn
By the end of this lesson, students can identify common flowchart symbols.

## Before We Start
What symbols have you seen in maps, apps, or signs?

## Let's Understand
A flowchart shows the steps of a process using standard symbols.

## Let's Practice
Label each flowchart symbol and describe its purpose.

## Challenge Task
Improve your flowchart by adding at least one decision symbol.

## Lesson Examples

### Example: Flowchart Symbols
Order: 1
Published: true

This example shows how a sequence of steps can be represented clearly.

Common mistake:
Students may confuse input/output with process symbols.
```

Supported main section headings are `What We'll Learn`, `Before We Start`, `Let's Understand`, `Let's Practice`, and `Challenge Task`. The importer also accepts the field names `Learning Targets`, `Before You Start`, and `Short Discussion` as aliases. A lesson example starts with a `### Example: title` heading; its body continues until `Common mistake:` (or `Common mistakes:`), after which the common-mistake text is collected. `Order:` and `Published:` are optional for examples; examples default to published.

The importer recognizes a `Resources` heading too, but it is left out of this text-only example because resources can point to separate files. Lesson import can also process images when their files are uploaded alongside the Markdown; image syntax is intentionally omitted here.

## 4. Quiz question Markdown import

In the quiz editor's **Import** tab, start each question block with one of these labels: `MCQ:`, `TF:`, `FILL:`, `ORDER:`, `MATCH:`, or `CODE:`. Put a blank line between question blocks. Do not put blank lines inside a question block.

```md
# Quiz Import Example

MCQ: Which tool compiles Java source code?
A. JVM
B. JDK *
C. HTML
D. CSS

TF: Java source files usually use the .java extension.
True *
False

FILL: Complete the command used to compile Java code.
javac
JAVAC

ORDER: Put the Java workflow in order.
Write source code
Compile with javac
Run with java

MATCH: Match each term to its meaning.
JDK => Tools for developing Java programs
JVM => Runs Java bytecode
javac => Compiles source code

CODE: What is the output?
System.out.println("Hello");
Output: Hello

CODE: What is the output on each line?
for (int i = 1; i <= 3; i++) {
    System.out.println(i);
}
Output: 1
2
3
```

- **MCQ:** mark the correct choice with `*`. A trailing `*`, as in `B. JDK *`, works; `* B. JDK` also works.
- **TF:** mark the correct `True` or `False` choice with `*`.
- **FILL:** put accepted answers on separate lines, or use `Answers: answer one, answer two`.
- **ORDER:** list the steps in the desired order.
- **MATCH:** write one pair per line with `left => right`.
- **CODE:** put code after the prompt and put expected output after `Output:`. Output may span multiple lines.

The importer creates editable question drafts. Review them in the editor before saving.

## 5. Generated module Markdown download

The module editor can download a complete Markdown backup, or a backup filtered to a grading period. This export is a readable backup format; it is not the same as the outline importer. The outline importer only reads a module title, topic headings, the listed topic metadata, and lesson-title bullets.

The export uses this hierarchy:

````md
# Module title
- Published: Yes

## Description
Module description text.

## Activity 1: Activity title
- Type: Quiz
- Points Possible: 10
- Grading Period: PRELIM
- Maximum Attempts: 2
- Passing Score: 70
- Accepts Text: No
- Accepts File: No
- Published: Yes

### Instructions
Activity instructions.

### Question 1: Code output
What is the output?

- Points: 1
- Published: Yes

#### Code Snippet

```java
System.out.println("Hello");
```

#### Expected Output

```
Hello
```

## Topic 1: Programming Basics
- Published: Yes

### Competency Code
CS11-IPO-001

### Overview
Topic overview text.

#### Lesson 1: IPO Model
- Published: Yes

#### Learning Targets
Lesson learning targets.

#### Example 1: Sample Example
- Published: Yes
Example body text.

#### Activity 1: Practice Quiz
- Type: Quiz
- Points Possible: 5

##### Question 1: Multiple choice
Which item is an output?

- Points: 1
- Published: Yes

###### Choices
- [ ] Keyboard input
- [x] Printed result

###### Explanation
The printed result is produced by the program.
````

Only populated text fields and available activity data appear in an export. Module fields can include Description, Content, Learning Objectives, Lesson Overview, Detailed Discussion, Examples, Teacher Notes, Student Activities, and Resources. Topic fields can include Competency Code/Text, Unit, Overview, Essential Question, Enduring Understanding, Performance Task, Success Criteria, and Values Focus. Lesson fields can include Learning Targets, Before You Start, Short Discussion, Guided Examples, Let's Practice, Challenge Task, Objectives, Overview, Subtopics, Acquisition, Making Meaning, Transfer, Examples, Teacher Notes, Answer Key, Expected Outputs, Common Misconceptions, Teaching Tips, Remediation, Enrichment, Student Activities, and Resources.

For this reference, exported lesson images and lesson asset links are omitted because they require separate files.
