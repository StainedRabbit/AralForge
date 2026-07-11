from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from learning_modules.models import Module, ModuleLesson, ModuleLessonExample, ModuleTopic
from subjects.models import Subject


def bullets(items):
    return '\n'.join(f'- {item}' for item in items)


def numbered(items):
    return '\n'.join(f'{index + 1}. {item}' for index, item in enumerate(items))


def java(code):
    return f'```java\n{code.strip()}\n```'


COMMON_RUBRIC = """Criteria - 20 points total
- Correctness (5): Output or answer follows the required concept and instructions.
- Completeness (4): All required parts are present.
- Logic and sequence (4): Steps, code, diagram, or pseudocode follow a clear order.
- Explanation (3): Student can explain what the work does and why it is correct.
- Neatness/readability (2): Work is easy to read, label, and check.
- Effort and revision (2): Student improves the work after feedback."""

HELLO_WORLD = java(
    """
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, CC 102!");
    }
}
"""
)

STUDENT_INFO = java(
    """
public class StudentInfo {
    public static void main(String[] args) {
        String name = "Ana";
        int age = 18;
        double grade = 95.5;
        System.out.println(name + " is " + age + " years old.");
        System.out.println("Grade: " + grade);
    }
}
"""
)

SCANNER_EXAMPLE = java(
    """
import java.util.Scanner;

public class InputExample {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        System.out.print("Enter your name: ");
        String name = input.nextLine();
        System.out.println("Hello, " + name + "!");
    }
}
"""
)

WRITE_FILE_EXAMPLE = java(
    """
import java.io.FileWriter;
import java.io.IOException;

public class WriteFileExample {
    public static void main(String[] args) {
        try {
            FileWriter writer = new FileWriter("student.txt");
            writer.write("Name: Ana\\nCourse: CC 102");
            writer.close();
            System.out.println("File saved.");
        } catch (IOException error) {
            System.out.println("An error occurred.");
        }
    }
}
"""
)

READ_FILE_EXAMPLE = java(
    """
import java.io.File;
import java.io.FileNotFoundException;
import java.util.Scanner;

public class ReadFileExample {
    public static void main(String[] args) {
        try {
            File file = new File("student.txt");
            Scanner reader = new Scanner(file);
            while (reader.hasNextLine()) {
                System.out.println(reader.nextLine());
            }
            reader.close();
        } catch (FileNotFoundException error) {
            System.out.println("File not found.");
        }
    }
}
"""
)

VISUALS = {
    'fundamentals': {
        'default': ('Java toolchain guide', '/lesson-assets/cc102/java-toolchain.svg'),
        'structure': ('Java program structure guide', '/lesson-assets/cc102/java-program-structure.svg'),
        'syntax': ('Java syntax correction guide', '/lesson-assets/cc102/java-syntax-correction.svg'),
    },
    'algorithms': {
        'default': ('Algorithm and IPO guide', '/lesson-assets/cc102/algorithm-ipo.svg'),
    },
    'flowcharts': {
        'default': ('Flowchart symbol guide', '/lesson-assets/cc102/flowchart-symbols.svg'),
        'decision': ('Flowchart sequence and decision guide', '/lesson-assets/cc102/flowchart-sequence-decision.svg'),
    },
    'pseudocode': {
        'default': ('Pseudocode pattern guide', '/lesson-assets/cc102/pseudocode-patterns.svg'),
    },
    'operators': {
        'default': ('Java operators reference', '/lesson-assets/cc102/operators-reference.svg'),
        'trace': ('Java operator tracing guide', '/lesson-assets/cc102/operator-trace.svg'),
    },
    'io': {
        'default': ('Java file input and output flow guide', '/lesson-assets/cc102/file-io-flow.svg'),
        'scanner': ('Scanner input flow guide', '/lesson-assets/cc102/scanner-input-flow.svg'),
    },
}


def image(alt, src):
    return f'![{alt}]({src})'


def visual_for(item):
    topic = item.get('category', item['topic'])
    title = item['title'].lower()

    if topic == 'fundamentals' and 'syntax' in title:
        return VISUALS[topic]['syntax']
    if topic == 'fundamentals' and any(word in title for word in ['first java', 'parts']):
        return VISUALS[topic]['structure']
    if topic == 'flowcharts' and any(word in title for word in ['sequence', 'decision', 'simple programming']):
        return VISUALS[topic]['decision']
    if topic == 'operators' and any(word in title for word in ['arithmetic', 'comparison', 'expressions']):
        return VISUALS[topic]['trace']
    if topic == 'io' and any(word in title for word in ['scanner', 'input', 'output']):
        return VISUALS[topic]['scanner']
    return VISUALS[topic]['default']


def rule(rule_text, example, check):
    return f'- Rule: {rule_text} Example: {example} Check: {check}'


def detailed_discussion(item):
    title = item['title']
    topic = item.get('category', item['topic'])
    alt, src = visual_for(item)
    discussion = [
        image(alt, src),
        (
            f"Let's work through {title} together. Our focus is {item['focus']}. "
            'We will move from meaning, to examples, to practice, then to a task we can explain.'
        ),
        'What this lesson means:',
        *topic_foundation_points(topic, title),
        'How we study it step by step:',
        *lesson_step_points(item),
        'Rules and patterns we should remember:',
        *rules_for_topic(topic, title),
        'Common mistakes we will watch for:',
        *mistake_points(topic, title),
        'Mini-check before practice:',
        *mini_check_points(topic, title),
        (
            "When we move to practice, our goal is not only to get an answer. "
            'Our goal is to explain the thinking: what information we used, what step happened next, '
            'why the result is correct, and what we changed after testing.'
        ),
    ]
    return '\n'.join(discussion)


def lesson_evidence(item):
    return (
        'Evidence we will use to check learning:\n'
        + bullets(
            [
                *item['expected'],
                'Completed guided-practice work with visible corrections or annotations.',
                'A short explanation connecting the output to the lesson target.',
            ]
        )
    )


def lesson_remediation(item):
    return (
        'For learners who need more support:\n'
        + bullets(
            [
                f'Reteach {item["focus"]} using one smaller worked example.',
                f'Use a checklist focused on: {", ".join(item["subtopics"][:3])}.',
                f'Address this likely difficulty directly: {item["misconceptions"][0]}',
                'Let the learner correct one partially completed output with teacher or peer guidance.',
                'Check understanding through a short oral explanation before independent retry.',
            ]
        )
    )


def lesson_enrichment(item):
    return (
        'For learners ready to extend the lesson:\n'
        + bullets(
            [
                f'Create a new example that applies {item["focus"]} in a different context.',
                f'Improve or extend the challenge task: {item["challenge"]}',
                'Test the solution with additional values, cases, or user requirements.',
                'Explain one design decision and one revision using evidence from testing.',
                'Prepare a short peer-teaching demonstration or annotated model output.',
            ]
        )
    )


def topic_foundation_points(topic, title):
    if topic == 'fundamentals':
        return [
            '- Java is a programming language we use to write instructions for a computer.',
            '- A Java program is written as source code, saved in a `.java` file, compiled, then run.',
            '- The JDK gives us the tools for building Java programs; the JVM runs the compiled bytecode.',
            '- An IDE helps us write, organize, run, and debug code in one workspace.',
            '- A beginner Java program usually has a class, a main method, statements, braces, and comments.',
            '- We read code from the outside container toward the inside instructions, then we trace what will display.',
        ]
    if topic == 'algorithms':
        return [
            '- An algorithm is an ordered list of steps that solves a problem or completes a task.',
            '- Before we code, we identify the input, process, and output so our solution has direction.',
            '- Good steps are clear enough that another person can follow them without guessing.',
            '- The order matters because computers follow instructions exactly as written.',
            '- We can test an algorithm with sample values before writing Java code.',
            '- A strong algorithm is specific, complete, logical, and easy to revise.',
        ]
    if topic == 'flowcharts':
        return [
            '- A flowchart is a visual plan of a process or program logic.',
            '- We use standard shapes so another person can read our diagram quickly.',
            '- The oval is the terminal symbol for Start and End.',
            '- The rectangle is the process symbol for actions, calculations, or assignments.',
            '- The parallelogram is for Input or Output, such as entering a grade or displaying a result.',
            '- The diamond is the decision symbol for questions with Yes/No or True/False branches.',
            '- Arrows are flowlines. They show the direction our logic follows.',
            '- Every decision branch should be labeled so the reader knows which path is taken.',
        ]
    if topic == 'pseudocode':
        return [
            '- Pseudocode is a plain-language plan for a program.',
            '- We use simple keywords like START, INPUT, SET, DISPLAY, IF, ELSE, and END.',
            '- Pseudocode is not Java yet, so it does not need semicolons or exact Java syntax.',
            '- It still needs clear order, complete logic, and consistent variable names.',
            '- Indentation helps us see which steps belong inside a decision.',
            '- We trace pseudocode with sample values before turning it into code.',
        ]
    if topic == 'operators':
        return [
            '- Variables store values so a program can use them later.',
            '- Data types tell Java what kind of value we are storing, such as int, double, char, boolean, or String.',
            '- Operators are symbols that perform actions on values.',
            '- Arithmetic operators compute numbers. Comparison operators produce true or false.',
            '- Logical operators combine conditions so programs can make better decisions.',
            '- We trace expressions carefully because order and parentheses can change the result.',
        ]
    return [
        '- Input lets a Java program receive information instead of using fixed values only.',
        '- Output lets a Java program communicate clear results to the user.',
        '- Scanner can read values typed by the user or lines from a file.',
        '- FileWriter can save text into a file so the data remains after the program runs.',
        '- File I/O needs careful testing because file names, file locations, and errors matter.',
        '- Clean prompts and labeled output make our programs easier to use and check.',
    ]


def lesson_step_points(item):
    topic = item.get('category', item['topic'])
    order = item.get('order')

    if topic == 'algorithms' and order == 8:
        return [
            '- First, we read the problem statement and underline the exact result the program must produce.',
            '- Next, we list the required input values before writing any solution steps.',
            '- Then, we choose the process: compute, compare, count, convert, or decide.',
            '- After that, we write ordered steps using action words that another student can follow.',
            '- We test the algorithm with at least two sample inputs, including one boundary or special case.',
            '- Finally, we revise any vague step until the expected output is clear before coding.',
        ]

    if topic == 'flowcharts':
        return flowchart_step_points(item)

    subtopics = item.get('subtopics', [])
    points = [
        f'- First, we connect the lesson to a familiar situation: {item["before"]}',
        '- Next, we name the important parts so everyone uses the same vocabulary.',
    ]
    for subtopic in subtopics[:5]:
        points.append(f'- Then, we study {subtopic} and ask: what does it do, where do we see it, and how can we check it?')
    points.extend(
        [
            '- After that, we compare a correct example with a common wrong version.',
            '- We trace the example slowly before running, drawing, or submitting anything.',
            '- Finally, we explain the result in our own words so the activity is not just copying.',
        ]
    )
    return points


def flowchart_step_points(item):
    order = item['order']
    if order == 9:
        return [
            '- First, we separate the idea of a program step from the shape used to draw it.',
            '- Next, we sort sample steps into terminal, process, input/output, decision, and flowline categories.',
            '- Then, we explain why each symbol fits the action instead of memorizing shapes only.',
            '- After that, we correct wrong-symbol examples such as a condition placed inside a rectangle.',
            '- Finally, we trace a very short diagram to prove that arrows, labels, and symbols work together.',
        ]
    if order == 10:
        return [
            '- First, we start from an existing algorithm for adding two numbers so the order is already clear.',
            '- Next, we convert each IPO step into the matching flowchart symbol.',
            '- Then, we align the symbols from top to bottom so the arrows can be followed without crossing.',
            '- After that, we trace the sequence using sample numbers and check that every step runs once.',
            '- Finally, we create a second sequence flowchart for total price to show the pattern transfers.',
        ]
    if order == 11:
        return [
            '- First, we identify the exact yes/no question that controls the program path.',
            '- Next, we place that question in a decision diamond and label both outgoing arrows.',
            '- Then, we draw the Yes and No outputs as separate branches so no path is missing.',
            '- After that, we trace two sample grades to prove each branch reaches the correct result.',
            '- Finally, we inspect the diagram for missing branch labels, disconnected arrows, or dead ends.',
        ]
    return [
        '- First, we analyze the full programming problem before drawing any shapes.',
        '- Next, we combine sequence steps for input and computation with a decision step for pass/fail logic.',
        '- Then, we draw the complete Average Grade Calculator flowchart with every path reaching End.',
        '- After that, we test the diagram with passing and failing grade sets and mark the path followed.',
        '- Finally, we revise the layout for readability, correct symbols, branch labels, and connected arrows.',
    ]


def rules_for_topic(topic, title):
    title = title.lower()
    if topic == 'fundamentals':
        return [
            rule('Java is case-sensitive, so `System` and `system` are not the same.', '`System.out.println("Hi");` works, but `system.out.println("Hi");` causes an error.', 'Which word must start with a capital S?'),
            rule('Text output must be inside double quotation marks.', '`System.out.println("Hello, Java!");` displays Hello, Java!', 'What text will appear on the screen?'),
            rule('Many Java statements end with a semicolon.', '`int score = 90;` is complete, but `int score = 90` is missing its ending mark.', 'What symbol should we add at the end?'),
            rule('Braces `{` and `}` must be paired because they show where a block starts and ends.', '`public class Demo { public static void main(String[] args) { } }` has matching class and main braces.', 'How many opening and closing braces can we count?'),
            rule('Comments explain code for humans and are ignored when the program runs.', '`// This line prints a greeting` helps us understand the next statement.', 'Will a comment display in the console?'),
        ]
    if topic == 'algorithms':
        return [
            rule('Use action words such as read, compute, compare, display, repeat, or stop.', 'Step 1: Read firstNumber. Step 2: Read secondNumber. Step 3: Compute sum.', 'Which word tells us the action in Step 3?'),
            rule('Put one clear action per step when possible.', 'Better: `Read grade`, then `Compare grade to 75`; unclear: `Check everything`.', 'Which version can a beginner follow?'),
            rule('Include the needed input before the process step.', 'For sum of two numbers, we first need number1 and number2 before computing sum.', 'What information must we ask for first?'),
            rule('Include the output after the process or decision step.', 'After computing `sum = 5 + 7`, we display `12`.', 'What should the user see at the end?'),
            rule('Test the algorithm with at least one sample value.', 'If number1 is 5 and number2 is 7, the expected sum is 12.', 'Does our step list produce 12?'),
        ]
    if topic == 'flowcharts':
        points = [
            rule('Start with one Start oval and finish with one End oval.', 'A basic flow is `Start -> Display "Hello" -> End`.', 'Where does the reader begin and stop?'),
            rule('Use rectangles for process steps.', 'A rectangle can contain `sum = num1 + num2` because it is a calculation.', 'Is this step doing an action or asking a question?'),
            rule('Use parallelograms for input and output.', 'A parallelogram can contain `Input grade` or `Display average`.', 'Is the program receiving or showing data?'),
            rule('Use diamonds for decisions.', 'A diamond can contain `grade >= 75?` because the answer is Yes or No.', 'What are the two possible paths?'),
            rule('Label decision arrows with Yes/No or True/False.', 'From `grade >= 75?`, the Yes arrow can go to `Display Passed` and the No arrow to `Display Try again`.', 'Can we tell which path to follow?'),
            rule('Avoid crossing arrows when a cleaner layout is possible.', 'Place steps from top to bottom when the logic is simple.', 'Can someone trace the diagram without confusion?'),
        ]
        if 'symbol' in title:
            points.extend(
                [
                    rule('The Start shape is an oval or rounded terminal with the word Start.', '`Start` inside an oval begins the flowchart.', 'What shape should we draw first?'),
                    rule('The End shape is an oval or rounded terminal with the word End.', '`End` inside an oval tells us the logic is finished.', 'What shape should close the flowchart?'),
                    rule('A condition belongs inside a diamond.', '`age >= 18?` goes in a diamond because it asks a question.', 'Should this be a rectangle or a diamond?'),
                    rule('A process belongs inside a rectangle.', '`total = price * quantity` goes in a rectangle because it computes a value.', 'What value is being created?'),
                    rule('Input and output belong inside a slanted parallelogram.', '`Input name` and `Display name` both use a parallelogram.', 'Are we receiving data or showing data?'),
                ]
            )
        return points
    if topic == 'pseudocode':
        return [
            rule('Use START and END to show the boundary of the plan.', '`START` begins the pseudocode and `END` closes it.', 'Where should the first and last lines be?'),
            rule('Use INPUT for values we need from the user.', '`INPUT grade` means the user or problem gives us a grade value.', 'What value are we receiving?'),
            rule('Use SET for assignment or computation.', '`SET average = total / 3` stores the computed average.', 'What variable receives the result?'),
            rule('Use DISPLAY for the result.', '`DISPLAY average` shows the computed value.', 'What should the user see?'),
            rule('Use IF, ELSE, and END IF for decisions.', '`IF grade >= 75 THEN DISPLAY "Passed" ELSE DISPLAY "Needs practice" END IF` handles two paths.', 'What condition decides the path?'),
            rule('Keep variable names consistent from beginning to end.', 'If we use `grade` in INPUT, use `grade` again in IF, not `score` unless we define it.', 'Did the variable name change?'),
        ]
    if topic == 'operators':
        return [
            rule('Use `=` to assign a value and `==` to compare equality.', '`score = 90;` stores 90, while `score == 90` asks if score is equal to 90.', 'Are we storing a value or asking a true/false question?'),
            rule('Use `+`, `-`, `*`, `/`, and `%` for arithmetic.', '`int remainder = 10 % 3;` stores 1 because 10 divided by 3 leaves 1.', 'What does `%` give us?'),
            rule('Use parentheses when we want a calculation to happen first.', '`average = (g1 + g2 + g3) / 3.0;` adds first, then divides.', 'What happens first inside the parentheses?'),
            rule('Use `&&` when both conditions must be true.', '`grade >= 75 && attendance >= 80` is true only when both checks pass.', 'What if attendance is only 70?'),
            rule('Use `||` when at least one condition may be true.', '`hasPermit || isTeacherApproved` is true if either side is true.', 'How many sides need to be true?'),
            rule('Use `!` to reverse a boolean condition.', '`!isAbsent` means the student is not absent.', 'If `isAbsent` is false, what is `!isAbsent`?'),
        ]
    return [
        rule('Import the class before using Scanner, FileWriter, or File.', '`import java.util.Scanner;` is needed before creating a Scanner for keyboard input.', 'Which import do we need for Scanner?'),
        rule('Show a clear prompt before reading user input.', '`System.out.print("Enter your name: ");` tells the user what to type.', 'What should the user enter?'),
        rule('Store input in a variable with a suitable data type.', '`String name = input.nextLine();` stores text, while `int age = input.nextInt();` stores a whole number.', 'Which method fits a name?'),
        rule('Label output so the user understands what the value means.', '`System.out.println("Average: " + average);` is clearer than printing only `average`.', 'What label helps us read the result?'),
        rule('Close file writers or readers when we are done.', '`writer.close();` finishes writing and releases the file.', 'What line tells Java we are done with the file?'),
        rule('Use simple error handling when a file might not exist or writing might fail.', '`catch (IOException error)` lets us display a helpful message instead of crashing silently.', 'What message should the user see if saving fails?'),
    ]


def mistake_points(topic, title):
    if topic == 'flowcharts':
        return [
            '- Using any shape randomly instead of standard symbols.',
            '- Forgetting the End symbol.',
            '- Drawing arrows that do not connect to the next step.',
            '- Putting a yes/no question inside a rectangle instead of a diamond.',
            '- Forgetting labels on decision branches.',
        ]
    if topic == 'pseudocode':
        return [
            '- Writing Java syntax instead of a clear plan.',
            '- Skipping INPUT or DISPLAY steps.',
            '- Changing variable names halfway through.',
            '- Forgetting END IF after a decision.',
            '- Not testing the pseudocode with sample data.',
        ]
    if topic == 'operators':
        return [
            '- Using String for values that should be numeric.',
            '- Confusing assignment `=` with comparison `==`.',
            '- Forgetting parentheses in average formulas.',
            '- Expecting integer division to keep decimals.',
            '- Reading `&&` and `||` without checking both sides of the condition.',
        ]
    if topic == 'io':
        return [
            '- Forgetting the import statement.',
            '- Asking for input without a clear prompt.',
            '- Reading the wrong data type.',
            '- Saving a file but not knowing where it was created.',
            '- Displaying unlabeled output that is hard to check.',
        ]
    if topic == 'algorithms':
        return [
            '- Writing a paragraph instead of ordered steps.',
            '- Starting with computation before identifying inputs.',
            '- Skipping the output step.',
            '- Combining several actions into one vague step.',
            '- Not testing whether another person can follow the algorithm.',
        ]
    return [
        '- Forgetting capitalization in Java keywords or class names.',
        '- Missing quotation marks, semicolons, or closing braces.',
        '- Thinking comments run as code.',
        '- Changing code without predicting the output first.',
        '- Submitting a screenshot without explaining what happened.',
    ]


def mini_check_points(topic, title):
    if topic == 'flowcharts':
        return [
            '- Which shape do we use for Start and End?',
            '- Which shape do we use when the program asks a yes/no question?',
            '- What should be written on the two arrows leaving a decision diamond?',
            '- Can we trace the diagram from Start to End without getting stuck?',
        ]
    if topic == 'pseudocode':
        return [
            '- What keyword shows that we receive data?',
            '- What keyword shows that we display a result?',
            '- Where should the steps inside an IF decision be placed?',
            '- Can we trace the pseudocode using sample values?',
        ]
    if topic == 'operators':
        return [
            '- What data type fits this value?',
            '- Are we assigning a value or comparing two values?',
            '- Which operation happens first?',
            '- Does the final expression produce a number or true/false?',
        ]
    if topic == 'io':
        return [
            '- What prompt will the user see?',
            '- What variable stores the input?',
            '- What output should appear?',
            '- If a file is used, where is it saved or read from?',
        ]
    if topic == 'algorithms':
        return [
            '- What is our input?',
            '- What process happens to the input?',
            '- What output should appear?',
            '- Are the steps clear enough for a classmate to follow?',
        ]
    return [
        '- What part of the Java program is the container?',
        '- Where does the program start running?',
        '- What line displays output?',
        '- What syntax rule should we check before running?',
    ]


def guided_examples_for(item):
    if item['title'] == 'Lesson 9: Flowchart Symbols And Program Logic':
        return '\n'.join(
            [
                "Let's look at five beginner-friendly flowchart examples. Read each scenario, trace the arrows, and answer the mini-check.",
                'After the examples, choose one model and explain it using this sentence: This flowchart works because _____. If we change _____, the path becomes _____.',
            ]
        )

    alt, src = visual_for(item)
    lines = [
        "Let's look at these examples together. We will read each model, notice the important part, then try a small change.",
        image(alt, src),
    ]

    for index, example in enumerate(item['examples'][:5], start=1):
        lines.extend(example_walkthrough(item, index, example))

    lines.append('After the examples, choose one model and explain it using this sentence: This works because _____. If we change _____, the result becomes _____.')
    return '\n'.join(lines)


def example_walkthrough(item, index, example):
    topic = item['topic']
    model = str(example)
    compact = model.replace('\n', ' ')
    if len(compact) > 72:
        compact = compact[:69] + '...'

    title = example_title(topic, index, compact)
    purpose = example_purpose(topic)
    notice = example_notice(topic, model)
    task = example_try_this(topic)

    return [
        '',
        f'Example {index}: {title}',
        f'Purpose: {purpose}',
        'Model:',
        model,
        f'What we notice: {notice}',
        f'Try this: {task}',
    ]


def example_title(topic, index, compact):
    labels = {
        'fundamentals': ['Reading Java code', 'Changing output', 'Multiple statements', 'Spotting a syntax issue', 'Connecting code to output'],
        'algorithms': ['Daily task algorithm', 'Input-process-output planning', 'Testing with sample data', 'Improving unclear steps', 'Explaining the final result'],
        'flowcharts': ['Basic flow', 'Input-process-output flow', 'Decision flow', 'Tracing a branch', 'Complete problem flow'],
        'pseudocode': ['Basic pseudocode pattern', 'IPO pseudocode', 'Decision pseudocode', 'Tracing pseudocode', 'Fixing incomplete logic'],
        'operators': ['Variable and data type model', 'Arithmetic expression', 'Average formula', 'Comparison condition', 'Logical condition'],
        'io': ['Input/output model', 'Prompt and response', 'Clean output display', 'Saving text to a file', 'Reading file contents'],
    }
    return labels.get(topic, ['Lesson model'])[min(index - 1, len(labels.get(topic, ['Lesson model'])) - 1)] + f' - {compact}'


def example_purpose(topic):
    if topic == 'fundamentals':
        return 'We use this model to connect Java structure, syntax, and output.'
    if topic == 'algorithms':
        return 'We use this model to turn a problem into ordered steps before coding.'
    if topic == 'flowcharts':
        return 'We use this model to see program logic as shapes and arrows.'
    if topic == 'pseudocode':
        return 'We use this model to plan the program in clear language before Java syntax.'
    if topic == 'operators':
        return 'We use this model to trace how values are stored, computed, compared, or combined.'
    return 'We use this model to understand how data enters, appears, saves, or loads in a Java program.'


def example_notice(topic, model):
    if '```java' in model:
        return 'The code is written as a complete Java model, so we can trace the statements from top to bottom and predict the output before running it.'
    if topic == 'flowcharts':
        return 'The model should have a clear start, connected arrows, correct symbols, and a clear end.'
    if topic == 'pseudocode':
        return 'The model uses readable keywords and keeps the logic clear without requiring exact Java syntax yet.'
    if topic == 'operators':
        return 'The expression has values, operators, and a result we can trace by hand.'
    if topic == 'algorithms':
        return 'The model becomes stronger when each step is specific, ordered, and testable.'
    if topic == 'io':
        return 'The model becomes easier to use when prompts and output labels are clear.'
    return 'The model shows one important beginner pattern that we can copy, change, and explain.'


def example_try_this(topic):
    if topic == 'fundamentals':
        return 'Change one name, message, comment, or output line, then predict the new output before running.'
    if topic == 'algorithms':
        return 'Replace the sample values or daily task, then check whether the steps still make sense.'
    if topic == 'flowcharts':
        return 'Trace the arrows with one sample value and mark the path we follow.'
    if topic == 'pseudocode':
        return 'Change one input value and trace each line until we reach the display step.'
    if topic == 'operators':
        return 'Substitute small numbers and compute the result by hand before checking in Java.'
    return 'Change the prompt, variable, output label, or file name, then explain what should happen.'


def lesson_examples_for(item):
    if item['title'] != 'Lesson 9: Flowchart Symbols And Program Logic':
        return []

    return [
        {'order': 1, 'title': 'Example 1: Sequence - Display a Welcome Message', 'alt_text': 'Sequence flowchart for displaying a welcome message', 'body': 'A simple program displays a welcome message to the user. This example shows a straight sequence from Start to End.', 'common_mistake': 'Do not use a diamond here because the program is not asking a Yes/No question.', 'mini_check': 'Which shape is used for displaying the message?', 'filename': 'cc102-flowchart-example-1-sequence.svg', 'steps': ['Start', 'message = "Welcome"', 'Display message', 'End']},
        {'order': 2, 'title': 'Example 2: Input and Output - Greet the User', 'alt_text': 'Input and output flowchart for greeting a user', 'body': "The program asks for the user's name, then displays a greeting using that name.", 'common_mistake': "Do not place 'Input name' inside a rectangle. Input and output steps should use a parallelogram.", 'mini_check': "Why is 'Input name' written inside a parallelogram?", 'filename': 'cc102-flowchart-example-2-input-output.svg', 'steps': ['Start', 'Input name', 'greeting = "Hello, " + name', 'Display greeting', 'End']},
        {'order': 3, 'title': 'Example 3: Process - Add Two Numbers', 'alt_text': 'Process flowchart for adding two numbers', 'body': 'The program receives two numbers, computes their sum, and displays the result.', 'common_mistake': "Do not use a parallelogram for 'sum = num1 + num2' because it is not receiving or displaying data. It is calculating a value.", 'mini_check': 'Which step creates a new value?', 'filename': 'cc102-flowchart-example-3-process.svg', 'steps': ['Start', 'Input num1', 'Input num2', 'sum = num1 + num2', 'Display sum', 'End']},
        {'order': 4, 'title': 'Example 4: Decision - Check if a Student Passed', 'alt_text': 'Decision flowchart for checking if a student passed', 'body': 'The program receives a grade. If the grade is 75 or higher, it displays Passed. Otherwise, it displays Try Again.', 'common_mistake': 'Do not forget to label the two arrows from the diamond. Without Yes and No labels, the reader may not know which path to follow.', 'mini_check': "What are the two possible answers to the decision 'grade >= 75?'", 'filename': 'cc102-flowchart-example-4-decision.svg', 'steps': ['Start', 'Input grade', 'grade >= 75?', 'Yes: Display Passed', 'No: Display Try Again', 'End']},
        {'order': 5, 'title': 'Example 5: Complete Logic - Compute Average and Check Result', 'alt_text': 'Complete flowchart for computing average and checking pass or fail', 'body': 'The program receives quiz, exam, and activity scores. It computes the average, then checks if the average is passing.', 'common_mistake': "Do not check 'average >= 75?' before computing the average. The value must be created first before it can be tested.", 'mini_check': 'Why should the average be computed before the decision diamond?', 'filename': 'cc102-flowchart-example-5-complete.svg', 'steps': ['Start', 'Input quiz, exam, activity', 'average = total / 3', 'average >= 75?', 'Yes: Display Passed', 'No: Display Failed', 'End']},
    ]


def flowchart_example_svg(title, steps):
    rows = []
    y = 95
    for index, step in enumerate(steps):
        is_terminal = index == 0 or index == len(steps) - 1
        is_decision = '?' in step
        is_io = step.lower().startswith(('input', 'display', 'yes:', 'no:'))
        if is_terminal:
            rows.append(f'<rect x="250" y="{y}" width="300" height="64" rx="32" fill="#dbeafe" stroke="#2563eb" stroke-width="4"/>')
        elif is_decision:
            rows.append(f'<polygon points="400,{y} 555,{y + 54} 400,{y + 108} 245,{y + 54}" fill="#fee2e2" stroke="#dc2626" stroke-width="4"/>')
        elif is_io:
            rows.append(f'<polygon points="280,{y} 570,{y} 520,{y + 70} 230,{y + 70}" fill="#fef3c7" stroke="#d97706" stroke-width="4"/>')
        else:
            rows.append(f'<rect x="235" y="{y}" width="330" height="70" rx="10" fill="#ccfbf1" stroke="#0f766e" stroke-width="4"/>')
        rows.append(f'<text x="400" y="{y + (58 if is_decision else 42)}" text-anchor="middle" fill="#0f172a" font-size="21" font-weight="700">{escape_svg(step)}</text>')
        if index < len(steps) - 1:
            y2 = y + (112 if is_decision else 74)
            rows.append(f'<path d="M400 {y2} V{y2 + 36}" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" marker-end="url(#arrow)"/>')
        y += 120 if is_decision else 108

    height = max(760, y + 40)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="{height}" viewBox="0 0 900 {height}" role="img">'
        '<defs><marker id="arrow" markerWidth="14" markerHeight="14" refX="12" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,10 L13,5 z" fill="#2563eb"/></marker></defs>'
        f'<rect width="900" height="{height}" fill="#f8fafc"/>'
        f'<rect x="32" y="32" width="836" height="{height - 64}" rx="28" fill="#ffffff" stroke="#e2e8f0" stroke-width="3"/>'
        f'<text x="450" y="68" text-anchor="middle" fill="#0f172a" font-family="Arial, sans-serif" font-size="28" font-weight="700">{escape_svg(title)}</text>'
        f'<g font-family="Arial, sans-serif">{"".join(rows)}</g></svg>'
    )


def escape_svg(value):
    return str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def practice_block(title, activity_type, time, instruction, tasks, output, code_sample=''):
    lines = [
        title,
        f'Type: {activity_type}',
        f'Time: {time}',
        f'Instruction: {instruction}',
        'Student task:',
        *[f'- {task}' for task in tasks],
    ]
    if code_sample:
        lines.extend(['Code / model:', code_sample])
    lines.append(f'Output: {output}')
    return '\n'.join(lines)


def detailed_practice_for(item):
    activities = practice_activities_for(item)
    return "Let's practice with these activities:\n\n" + '\n\n'.join(
        practice_block(**activity) for activity in activities
    )


def practice_activities_for(item):
    topic = item.get('category', item['topic'])
    order = item['order']

    if topic == 'fundamentals':
        return fundamentals_practice(item)
    if topic == 'algorithms':
        return algorithms_practice(order)
    if topic == 'flowcharts':
        return flowcharts_practice(order)
    if topic == 'pseudocode':
        return pseudocode_practice(order)
    if topic == 'operators':
        return operators_practice(order)
    return io_practice(order)


def fundamentals_practice(item):
    order = item['order']
    if order == 1:
        return [
            {
                'title': 'Activity 1: Java Around Us Quick Map',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Create a quick map showing where programming appears in everyday systems.',
                'tasks': ['Write Java or Programming at the center.', 'Add five systems: school portal, ATM, mobile app, game, and store cashier.', 'For each system, write one possible input and one possible output.'],
                'output': 'Submit a concept map with at least five systems and five input/output pairs.',
            },
            {
                'title': 'Activity 2: Input, Process, Output Hunt',
                'activity_type': 'pair',
                'time': '10 minutes',
                'instruction': 'Identify IPO parts from familiar systems.',
                'tasks': ['Choose two systems from your quick map.', 'Write the input, process, and output for each.', 'Explain which part a Java program might handle.'],
                'output': 'Submit two IPO rows and one short explanation.',
            },
            {
                'title': 'Activity 3: Vocabulary Match',
                'activity_type': 'individual',
                'time': '7 minutes',
                'instruction': 'Match each term to the best meaning.',
                'tasks': ['Program - ____', 'Developer - ____', 'Output - ____', 'Application - ____', 'Java - ____'],
                'output': 'Submit completed matches and one sentence using the word program.',
            },
            {
                'title': 'Activity 4: Explain Java Simply',
                'activity_type': 'class discussion',
                'time': '8 minutes',
                'instruction': 'Explain Java using beginner-friendly language.',
                'tasks': ['Write a two-sentence explanation.', 'Use the words instructions and output.', 'Share with a partner and improve one word or phrase.'],
                'output': 'Submit the improved two-sentence explanation.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Show what we can remember before leaving the lesson.',
                'tasks': ['Write three Java-related terms.', 'Write one system that could use programming.', 'Write one question you still have.'],
                'output': 'Submit a 3-1-1 exit ticket.',
            },
        ]
    if order == 2:
        return [
            {
                'title': 'Activity 1: Tool Role Sort',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Sort each Java tool by what it does.',
                'tasks': ['JDK - builds, runs, or writes?', 'IDE - builds, runs, or writes?', 'Compiler - translates or displays?', 'JVM - edits code or runs bytecode?'],
                'output': 'Submit a tool-role table with four correct rows.',
            },
            {
                'title': 'Activity 2: Setup Checklist',
                'activity_type': 'hands-on coding',
                'time': '12 minutes',
                'instruction': 'Check whether the computer is ready for Java.',
                'tasks': ['Open the IDE or terminal.', 'Find the Java version or IDE welcome screen.', 'Record what tool opened successfully.', 'Write one issue if something did not open.'],
                'output': 'Submit a setup checklist and screenshot or written evidence.',
            },
            {
                'title': 'Activity 3: First Project Test Run',
                'activity_type': 'hands-on coding',
                'time': '15 minutes',
                'instruction': 'Create a basic Java project and run a simple output program.',
                'tasks': ['Create a new Java file.', 'Type the sample program.', 'Run the program.', 'Circle or copy the console output.'],
                'code_sample': HELLO_WORLD,
                'output': 'Submit the output and one sentence explaining what ran successfully.',
            },
            {
                'title': 'Activity 4: Troubleshooting Log',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Practice reading setup or run problems calmly.',
                'tasks': ['Write one problem that could happen during setup.', 'Write one possible cause.', 'Write one possible fix.', 'Ask a partner if the fix is clear.'],
                'output': 'Submit one problem-cause-fix row.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Check tool understanding.',
                'tasks': ['Which tool helps us write code?', 'Which tool runs bytecode?', 'Which command or screen proved Java worked?'],
                'output': 'Submit three short answers.',
            },
        ]
    if order == 3:
        return [
            {
                'title': 'Activity 1: Predict The Output',
                'activity_type': 'individual',
                'time': '6 minutes',
                'instruction': 'Read the Java code before running it and predict what appears.',
                'tasks': ['Underline the output statement.', 'Write the exact text you think will appear.', 'Run or compare with the model output.'],
                'code_sample': HELLO_WORLD,
                'output': 'Submit prediction, actual output, and one correction if needed.',
            },
            {
                'title': 'Activity 2: Change The Message',
                'activity_type': 'hands-on coding',
                'time': '10 minutes',
                'instruction': 'Edit the printed message while keeping valid Java syntax.',
                'tasks': ['Change Hello, CC 102! to your name.', 'Keep the quotation marks.', 'Keep the semicolon.', 'Run the program again.'],
                'output': 'Submit the edited print line and output.',
            },
            {
                'title': 'Activity 3: Add More Lines',
                'activity_type': 'hands-on coding',
                'time': '10 minutes',
                'instruction': 'Add more output statements to create a short profile.',
                'tasks': ['Add one line for your section.', 'Add one line for your learning goal.', 'Predict the order of output lines before running.'],
                'output': 'Submit three output lines in the correct order.',
            },
            {
                'title': 'Activity 4: Mini Debug',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Find and fix the syntax error.',
                'tasks': ['Find the missing symbol.', 'Rewrite the corrected line.', 'Explain why Java needs the correction.'],
                'code_sample': java('System.out.println("Welcome to Java!");\nSystem.out.println("We are learning output")'),
                'output': 'Submit corrected code and one explanation sentence.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Summarize the first Java program.',
                'tasks': ['What line displays output?', 'What symbols surround text?', 'What symbol ends the statement?'],
                'output': 'Submit three short answers.',
            },
        ]
    if order == 4:
        return [
            {
                'title': 'Activity 1: Label The Program',
                'activity_type': 'individual',
                'time': '10 minutes',
                'instruction': 'Identify the main parts of a Java program.',
                'tasks': ['Label the class name.', 'Label the main method.', 'Label two variables.', 'Label one output statement.', 'Label one comment.'],
                'code_sample': STUDENT_INFO,
                'output': 'Submit a labeled copy or a table of line number and program part.',
            },
            {
                'title': 'Activity 2: Brace Pair Check',
                'activity_type': 'pair',
                'time': '7 minutes',
                'instruction': 'Trace which braces belong together.',
                'tasks': ['Count opening braces.', 'Count closing braces.', 'Draw pairs or write Class block and Main block.', 'Explain what happens if one brace is missing.'],
                'output': 'Submit brace count and one explanation.',
            },
            {
                'title': 'Activity 3: Comment The Code',
                'activity_type': 'hands-on coding',
                'time': '10 minutes',
                'instruction': 'Add helpful comments that explain code purpose.',
                'tasks': ['Add one comment before the variable declarations.', 'Add one comment before output statements.', 'Do not comment every single word.', 'Run the code to confirm comments do not display.'],
                'output': 'Submit code with two meaningful comments and output.',
            },
            {
                'title': 'Activity 4: Variable Purpose Table',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Explain what each variable stores.',
                'tasks': ['Create columns: variable, data type, value, purpose.', 'Fill in name, age, and grade.', 'Write one sentence explaining why variables are useful.'],
                'output': 'Submit the table and sentence.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Check program-part vocabulary.',
                'tasks': ['What part starts the Java program?', 'What part stores a value?', 'What part is ignored by Java but helps humans?'],
                'output': 'Submit three answers.',
            },
        ]
    return [
        {
            'title': 'Activity 1: Syntax Spot-The-Error',
            'activity_type': 'individual',
            'time': '10 minutes',
            'instruction': 'Find beginner Java syntax mistakes.',
            'tasks': ['Check capitalization.', 'Check quotation marks.', 'Check semicolons.', 'Check braces.', 'Circle or list each mistake.'],
            'code_sample': java('public class SyntaxCheck {\n    public static void main(String[] args) {\n        system.out.println("Hi)\n        System.out.println("Java")\n    }\n}'),
            'output': 'Submit the list of errors and corrected code.',
        },
        {
            'title': 'Activity 2: Fix One Line At A Time',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Correct each broken line and explain the rule.',
            'tasks': ['Fix `System.out.println("Hello")`.', 'Fix `system.out.println("Hi");`.', 'Fix `System.out.println(Hi);`.', 'Write the rule used for each fix.'],
            'output': 'Submit three corrected lines and three matching rules.',
        },
        {
            'title': 'Activity 3: Error Explanation',
            'activity_type': 'individual',
            'time': '8 minutes',
            'instruction': 'Explain why syntax matters.',
            'tasks': ['Choose one corrected error.', 'Write what was wrong.', 'Write how the correction helps Java understand the instruction.'],
            'output': 'Submit a three-sentence explanation.',
        },
        {
            'title': 'Activity 4: Create An Error For A Partner',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Write one intentionally broken Java line for a partner to fix.',
            'tasks': ['Create one missing semicolon error or quote error.', 'Trade with a partner.', 'Fix your partner\'s line.', 'Explain the correction.'],
            'output': 'Submit the broken line, corrected line, and explanation.',
        },
        {
            'title': 'Activity 5: Exit Ticket',
            'activity_type': 'exit ticket',
            'time': '5 minutes',
            'instruction': 'Use the syntax checklist before leaving.',
            'tasks': ['Write one capitalization rule.', 'Write one punctuation rule.', 'Write one brace rule.'],
            'output': 'Submit the three-rule checklist.',
        },
    ]


def algorithms_practice(order):
    if order == 6:
        return [
            {
                'title': 'Activity 1: Everyday Steps To Algorithm',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Turn a familiar task into ordered steps.',
                'tasks': ['Choose logging in to a computer or submitting an assignment.', 'Write 8-10 numbered steps.', 'Mark the input/materials and expected output.'],
                'output': 'Submit an ordered algorithm with input/materials and output.',
            },
            {
                'title': 'Activity 2: Arrange The Algorithm',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Put scrambled steps in the correct order.',
                'tasks': ['Arrange: display welcome screen, type password, click login, open computer, type username.', 'Rewrite the corrected order.', 'Explain why one step must come first.'],
                'output': 'Submit corrected order and one explanation.',
            },
            {
                'title': 'Activity 3: Missing Step Detective',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Find missing steps that make an algorithm unclear.',
                'tasks': ['Read: Open IDE, run program, submit output.', 'Add at least three missing steps.', 'Check if a beginner could follow it.'],
                'output': 'Submit improved algorithm.',
            },
            {
                'title': 'Activity 4: Partner Test',
                'activity_type': 'pair',
                'time': '10 minutes',
                'instruction': 'Test whether another person can follow your steps exactly.',
                'tasks': ['Exchange algorithms.', 'Follow your partner\'s steps without adding hidden steps.', 'Mark confusing steps.', 'Revise your own algorithm.'],
                'output': 'Submit original steps, partner feedback, and revised steps.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Check algorithm vocabulary.',
                'tasks': ['Define algorithm in your own words.', 'Write one reason order matters.', 'Write one example of output.'],
                'output': 'Submit three short answers.',
            },
        ]
    if order == 7:
        return [
            {
                'title': 'Activity 1: IPO Table',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Identify input, process, and output before writing steps.',
                'tasks': ['Problem: display the sum of two numbers.', 'Input: ____ and ____.', 'Process: ____.', 'Output: ____.'],
                'output': 'Submit the completed IPO table.',
            },
            {
                'title': 'Activity 2: Write The Algorithm',
                'activity_type': 'individual',
                'time': '10 minutes',
                'instruction': 'Write clear steps for the sum problem.',
                'tasks': ['Start.', 'Read first number.', 'Read second number.', 'Compute sum.', 'Display sum.', 'End. Rewrite these as complete numbered steps.'],
                'output': 'Submit a complete algorithm.',
            },
            {
                'title': 'Activity 3: Trace With Values',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Test the algorithm with sample values.',
                'tasks': ['Use first number = 8 and second number = 4.', 'Write the value after the process step.', 'Write the output.', 'Try another pair of numbers.'],
                'output': 'Submit two trace rows.',
            },
            {
                'title': 'Activity 4: Improve Vague Steps',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Rewrite unclear algorithm steps.',
                'tasks': ['Improve: Get numbers.', 'Improve: Do math.', 'Improve: Show answer.', 'Explain why the new steps are clearer.'],
                'output': 'Submit three improved steps and one explanation.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Review IPO planning.',
                'tasks': ['What is input?', 'What is process?', 'What is output?'],
                'output': 'Submit three definitions with examples.',
            },
        ]
    return [
        {
            'title': 'Activity 1: Problem Analysis',
            'activity_type': 'individual',
            'time': '8 minutes',
            'instruction': 'Read a problem and identify what must be solved.',
            'tasks': ['Problem: display the larger of two numbers.', 'Underline the needed input.', 'Write the decision question.', 'Write the expected output.'],
            'output': 'Submit problem notes with input, decision, and output.',
        },
        {
            'title': 'Activity 2: Build The Algorithm',
            'activity_type': 'individual',
            'time': '12 minutes',
            'instruction': 'Create a complete algorithm for a decision problem.',
            'tasks': ['Start.', 'Read num1 and num2.', 'Compare num1 and num2.', 'Display the larger number.', 'End.', 'Add clear Yes/No or if/else wording.'],
            'output': 'Submit the complete larger-number algorithm.',
        },
        {
            'title': 'Activity 3: Trace Table',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Test the algorithm using sample values.',
            'tasks': ['Trace num1 = 8, num2 = 3.', 'Trace num1 = 4, num2 = 9.', 'Trace num1 = 6, num2 = 6.', 'Write what should display each time.'],
            'output': 'Submit three trace rows.',
        },
        {
            'title': 'Activity 4: Peer Debug',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Review a partner\'s algorithm for missing or unclear logic.',
            'tasks': ['Check if input is complete.', 'Check if the decision is clear.', 'Check if every path has output.', 'Suggest one revision.'],
            'output': 'Submit peer feedback and revised algorithm.',
        },
        {
            'title': 'Activity 5: Exit Ticket',
            'activity_type': 'exit ticket',
            'time': '5 minutes',
            'instruction': 'Explain testing before coding.',
            'tasks': ['Why do we trace an algorithm?', 'What sample values did we use?', 'What did we revise?'],
            'output': 'Submit three short answers.',
        },
    ]


def flowcharts_practice(order):
    if order == 9:
        return [
            {
                'title': 'Activity 1: Match Flowchart Symbols',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Match each symbol to its purpose.',
                'tasks': ['Oval - ____', 'Rectangle - ____', 'Parallelogram - ____', 'Diamond - ____', 'Arrow - ____'],
                'output': 'Submit five matched symbols and purposes.',
            },
            {
                'title': 'Activity 2: Symbol Decision Drill',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Choose the correct flowchart shape for each step.',
                'tasks': ['Start the program.', 'Input grade.', 'average = total / 3.', 'grade >= 75?', 'Display Passed.', 'End the program.'],
                'output': 'Submit each step with the correct symbol name.',
            },
            {
                'title': 'Activity 3: Trace The Mini Flow',
                'activity_type': 'pair',
                'time': '10 minutes',
                'instruction': 'Trace a basic flowchart from Start to End.',
                'tasks': ['Use Start -> Input name -> Display name -> End.', 'Write the symbol for each step.', 'Draw arrows in the correct order.'],
                'output': 'Submit a simple drawn flowchart.',
            },
            {
                'title': 'Activity 4: Fix The Wrong Symbol',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Correct a flowchart that uses the wrong shapes.',
                'tasks': ['Find a decision written in a rectangle.', 'Find an input written in an oval.', 'Rewrite the steps with correct symbols.'],
                'output': 'Submit corrected symbol choices.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Check symbol memory.',
                'tasks': ['What shape is Start?', 'What shape is a condition?', 'What do arrows show?'],
                'output': 'Submit three answers.',
            },
        ]
    if order == 10:
        return [
            {
                'title': 'Activity 1: From Steps To Sequence Flowchart',
                'activity_type': 'individual',
                'time': '10 minutes',
                'instruction': 'Convert ordered steps into a sequence flowchart.',
                'tasks': ['Start.', 'Input num1 and num2.', 'Compute sum = num1 + num2.', 'Display sum.', 'End.'],
                'output': 'Submit a top-to-bottom sequence flowchart.',
            },
            {
                'title': 'Activity 2: Arrow Direction Check',
                'activity_type': 'pair',
                'time': '7 minutes',
                'instruction': 'Check whether the arrows guide the reader correctly.',
                'tasks': ['Trace your flowchart from Start.', 'Number each arrow in order.', 'Find any missing or crossing arrows.', 'Revise the layout.'],
                'output': 'Submit revised flowchart with numbered arrows.',
            },
            {
                'title': 'Activity 3: IPO Flowchart Labels',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Label input, process, and output in the flowchart.',
                'tasks': ['Mark the input symbol.', 'Mark the process symbol.', 'Mark the output symbol.', 'Write one sentence explaining the flow.'],
                'output': 'Submit labeled flowchart and explanation.',
            },
            {
                'title': 'Activity 4: Create A New Sequence',
                'activity_type': 'individual',
                'time': '12 minutes',
                'instruction': 'Create a sequence flowchart for total price.',
                'tasks': ['Input price and quantity.', 'Compute total = price * quantity.', 'Display total.', 'Use correct symbols and arrows.'],
                'output': 'Submit a total-price sequence flowchart.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Review sequence logic.',
                'tasks': ['What makes a flowchart sequential?', 'What symbol handles computation?', 'Why should arrows be connected?'],
                'output': 'Submit three answers.',
            },
        ]
    if order == 11:
        return [
            {
                'title': 'Activity 1: Decision Question Builder',
                'activity_type': 'individual',
                'time': '8 minutes',
                'instruction': 'Write conditions that can go inside decision diamonds.',
                'tasks': ['grade >= 75?', 'age >= 18?', 'number % 2 == 0?', 'Write one more condition of your own.'],
                'output': 'Submit four decision questions.',
            },
            {
                'title': 'Activity 2: Pass/Fail Flowchart',
                'activity_type': 'individual',
                'time': '12 minutes',
                'instruction': 'Draw a flowchart with one decision.',
                'tasks': ['Start.', 'Input grade.', 'Decision: grade >= 75?', 'Yes: Display Passed.', 'No: Display Try again.', 'End.'],
                'output': 'Submit a pass/fail flowchart with Yes and No labels.',
            },
            {
                'title': 'Activity 3: Trace Two Branches',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Trace both branches of a decision flowchart.',
                'tasks': ['Trace grade = 90.', 'Trace grade = 70.', 'Write the path taken for each value.', 'Write the output for each value.'],
                'output': 'Submit two trace paths.',
            },
            {
                'title': 'Activity 4: Fix Missing Branch Labels',
                'activity_type': 'pair',
                'time': '8 minutes',
                'instruction': 'Correct a decision flowchart with unlabeled branches.',
                'tasks': ['Find the two arrows leaving the diamond.', 'Label them Yes and No.', 'Check if both branches lead to output.', 'Revise if a branch is missing.'],
                'output': 'Submit corrected branch labels and outputs.',
            },
            {
                'title': 'Activity 5: Exit Ticket',
                'activity_type': 'exit ticket',
                'time': '5 minutes',
                'instruction': 'Review decision flowcharts.',
                'tasks': ['What shape holds a condition?', 'Why do branches need labels?', 'What are two possible outputs for pass/fail?'],
                'output': 'Submit three answers.',
            },
        ]
    return [
        {
            'title': 'Activity 1: Problem To Flowchart Plan',
            'activity_type': 'individual',
            'time': '8 minutes',
            'instruction': 'Analyze the Average Grade Calculator problem before drawing.',
            'tasks': ['Input grade1, grade2, grade3.', 'Compute average.', 'Check if average >= 75.', 'Display Passed or Try again.'],
            'output': 'Submit IPO and decision notes.',
        },
        {
            'title': 'Activity 2: Draw The Full Flowchart',
            'activity_type': 'individual',
            'time': '15 minutes',
            'instruction': 'Create a complete flowchart with sequence and decision logic.',
            'tasks': ['Use Start and End ovals.', 'Use parallelograms for input/output.', 'Use a rectangle for average formula.', 'Use a diamond for pass/fail.', 'Label Yes and No branches.'],
            'output': 'Submit the complete Average Grade Calculator flowchart.',
        },
        {
            'title': 'Activity 3: Trace With Sample Grades',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Test the flowchart with two sets of grades.',
            'tasks': ['Trace 90, 85, 80.', 'Trace 70, 72, 74.', 'Write the average and output for each set.', 'Mark the branch followed.'],
            'output': 'Submit two trace rows and marked paths.',
        },
        {
            'title': 'Activity 4: Peer Review Checklist',
            'activity_type': 'pair',
            'time': '8 minutes',
            'instruction': 'Check if another flowchart is complete and readable.',
            'tasks': ['Check correct symbols.', 'Check arrows.', 'Check branch labels.', 'Check if every path reaches End.', 'Suggest one improvement.'],
            'output': 'Submit peer checklist and one revision.',
        },
        {
            'title': 'Activity 5: Exit Ticket',
            'activity_type': 'exit ticket',
            'time': '5 minutes',
            'instruction': 'Reflect on visual logic.',
            'tasks': ['Which part was easiest to draw?', 'Which symbol do you still need to practice?', 'Why test with sample values?'],
            'output': 'Submit three answers.',
        },
    ]


def pseudocode_practice(order):
    if order == 13:
        focus_tasks = ['Identify START and END.', 'Circle INPUT, SET, and DISPLAY.', 'Explain why pseudocode is not Java yet.']
    elif order == 14:
        focus_tasks = ['Write pseudocode for sum of two numbers.', 'Use INPUT, SET, and DISPLAY.', 'Trace with num1 = 6 and num2 = 9.']
    elif order == 15:
        focus_tasks = ['Write pseudocode for pass/fail grade.', 'Use IF, ELSE, and END IF.', 'Trace grade = 80 and grade = 70.']
    else:
        focus_tasks = ['Find missing INPUT, SET, DISPLAY, or END IF lines.', 'Rewrite broken pseudocode.', 'Explain each correction.']
    return [
        {
            'title': 'Activity 1: Pseudocode Keyword Check',
            'activity_type': 'individual',
            'time': '7 minutes',
            'instruction': 'Review the keywords we use for program planning.',
            'tasks': ['START means ____.', 'INPUT means ____.', 'SET means ____.', 'DISPLAY means ____.', 'IF/ELSE means ____.'],
            'output': 'Submit five completed keyword meanings.',
        },
        {
            'title': 'Activity 2: Guided Pseudocode Task',
            'activity_type': 'individual',
            'time': '12 minutes',
            'instruction': 'Write or revise pseudocode for this lesson focus.',
            'tasks': focus_tasks,
            'output': 'Submit complete pseudocode and trace notes.',
        },
        {
            'title': 'Activity 3: Complete The Missing Lines',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Fill in missing pseudocode lines.',
            'tasks': ['START', 'INPUT grade', '____ average = grade', 'IF average >= 75 THEN', '____ "Passed"', 'ELSE', 'DISPLAY "Try again"', '____ IF', 'END'],
            'output': 'Submit completed missing lines.',
        },
        {
            'title': 'Activity 4: Trace With Values',
            'activity_type': 'pair',
            'time': '8 minutes',
            'instruction': 'Trace pseudocode manually before coding.',
            'tasks': ['Choose two sample inputs.', 'Write each variable value after SET.', 'Write the displayed output.', 'Mark which IF path was followed.'],
            'output': 'Submit a two-row trace table.',
        },
        {
            'title': 'Activity 5: Exit Ticket',
            'activity_type': 'exit ticket',
            'time': '5 minutes',
            'instruction': 'Check pseudocode readiness.',
            'tasks': ['What keyword receives data?', 'What keyword shows output?', 'Why do we trace pseudocode?'],
            'output': 'Submit three answers.',
        },
    ]


def operators_practice(order):
    if order == 17:
        code_sample = java('String name = "Ana";\nint age = 18;\ndouble average = 91.5;\nboolean passed = true;')
        focus_tasks = ['Identify the data type of each variable.', 'Write one valid value for each data type.', 'Explain why average uses double.']
    elif order == 18:
        code_sample = java('int a = 10;\nint b = 3;\nint sum = a + b;\nint remainder = a % b;\ndouble average = (90 + 85 + 88) / 3.0;')
        focus_tasks = ['Compute sum.', 'Compute remainder.', 'Compute average.', 'Explain why parentheses help.']
    elif order == 19:
        code_sample = java('int grade = 82;\nboolean present = true;\nboolean passed = grade >= 75;\nboolean canReceiveCertificate = passed && present;')
        focus_tasks = ['Evaluate passed.', 'Evaluate canReceiveCertificate.', 'Change present to false and trace again.']
    else:
        code_sample = java('double price = 25.50;\nint quantity = 4;\ndouble total = price * quantity;\nboolean hasDiscount = total >= 100;\ndouble finalTotal = hasDiscount ? total - 10 : total;')
        focus_tasks = ['Trace total.', 'Trace hasDiscount.', 'Trace finalTotal.', 'Explain the expression order.']
    return [
        {
            'title': 'Activity 1: Trace The Expression',
            'activity_type': 'individual',
            'time': '10 minutes',
            'instruction': 'Trace values before running Java.',
            'tasks': focus_tasks,
            'code_sample': code_sample,
            'output': 'Submit a trace table with expression and result.',
        },
        {
            'title': 'Activity 2: Predict The Output',
            'activity_type': 'individual',
            'time': '8 minutes',
            'instruction': 'Predict what the program would display if we printed each result.',
            'tasks': ['Write the expected output for each variable.', 'Check if the output is a number, text, or true/false.', 'Correct one prediction after tracing.'],
            'output': 'Submit predicted output lines.',
        },
        {
            'title': 'Activity 3: Fix The Operator Error',
            'activity_type': 'pair',
            'time': '10 minutes',
            'instruction': 'Find and correct an operator mistake.',
            'tasks': ['Check if `=` or `==` is needed.', 'Check if parentheses are missing.', 'Check if the data type fits the result.', 'Rewrite the corrected expression.'],
            'code_sample': java('int grade = 90;\nboolean passed = grade = 75;\ndouble average = 90 + 85 + 88 / 3.0;'),
            'output': 'Submit corrected expressions and rule explanations.',
        },
        {
            'title': 'Activity 4: Complete The Java Expression',
            'activity_type': 'hands-on coding',
            'time': '12 minutes',
            'instruction': 'Fill in missing operators to make the expression work.',
            'tasks': ['Complete `sum = a ____ b;`.', 'Complete `passed = grade ____ 75;`.', 'Complete `valid = passed ____ present;`.', 'Run or trace the completed expressions.'],
            'output': 'Submit completed expressions and results.',
        },
        {
            'title': 'Activity 5: Exit Ticket',
            'activity_type': 'exit ticket',
            'time': '5 minutes',
            'instruction': 'Review operator use.',
            'tasks': ['What does `=` do?', 'What does `==` do?', 'When should we use parentheses?'],
            'output': 'Submit three answers.',
        },
    ]


def io_practice(order):
    if order == 21:
        code_sample = SCANNER_EXAMPLE
        focus_tasks = ['Find the import statement.', 'Find the prompt.', 'Find where input is stored.', 'Change the variable name safely.']
    elif order == 22:
        code_sample = java('String name = "Ana";\nint grade = 95;\nSystem.out.println("Student: " + name);\nSystem.out.println("Grade: " + grade);')
        focus_tasks = ['Label each output.', 'Improve one output message.', 'Predict the exact console display.']
    elif order == 23:
        code_sample = WRITE_FILE_EXAMPLE
        focus_tasks = ['Find the FileWriter line.', 'Find the file name.', 'Find the write line.', 'Find the close line.']
    elif order == 24:
        code_sample = READ_FILE_EXAMPLE
        focus_tasks = ['Find the File object.', 'Find the Scanner reader.', 'Find the loop that reads lines.', 'Explain what happens if the file is missing.']
    else:
        code_sample = java('Scanner input = new Scanner(System.in);\nSystem.out.print("Enter name: ");\nString name = input.nextLine();\n// Save name to student.txt, then display a clean summary.')
        focus_tasks = ['Plan input fields.', 'Plan output labels.', 'Plan file name.', 'Plan test evidence.']
    return [
        {
            'title': 'Activity 1: I/O Code Walkthrough',
            'activity_type': 'individual',
            'time': '10 minutes',
            'instruction': 'Read the model and label the important input/output or file parts.',
            'tasks': focus_tasks,
            'code_sample': code_sample,
            'output': 'Submit labeled code parts and one explanation.',
        },
        {
            'title': 'Activity 2: Predict The Program Behavior',
            'activity_type': 'pair',
            'time': '8 minutes',
            'instruction': 'Predict what the user sees or what file action happens.',
            'tasks': ['Write what appears before input.', 'Write what value is stored or saved.', 'Write what output or file content should appear.', 'Compare with the code model.'],
            'output': 'Submit predicted behavior in three steps.',
        },
        {
            'title': 'Activity 3: Complete The Missing Line',
            'activity_type': 'hands-on coding',
            'time': '12 minutes',
            'instruction': 'Complete one missing Java I/O line.',
            'tasks': ['Add the needed import.', 'Add a prompt.', 'Add an input/read/write line.', 'Add a clear output line.'],
            'code_sample': java('// Complete the missing lines for this lesson focus.\n// import goes here\npublic class PracticeIO {\n    public static void main(String[] args) {\n        // prompt, read/write, and output go here\n    }\n}'),
            'output': 'Submit completed code or completed missing lines.',
        },
        {
            'title': 'Activity 4: Test Evidence',
            'activity_type': 'individual',
            'time': '10 minutes',
            'instruction': 'Gather evidence that the program behavior is correct.',
            'tasks': ['Run or trace with sample data.', 'Record input used.', 'Record console output.', 'If a file is involved, record file name and expected contents.'],
            'output': 'Submit input, output, and file evidence notes.',
        },
        {
            'title': 'Activity 5: Exit Ticket',
            'activity_type': 'exit ticket',
            'time': '5 minutes',
            'instruction': 'Review Java I/O habits.',
            'tasks': ['Why do prompts matter?', 'Why should output be labeled?', 'Why do file programs need testing?'],
            'output': 'Submit three answers.',
        },
    ]

TOPICS = [
    {
        'key': 'fundamentals',
        'order': 1,
        'title': 'Java Fundamentals, Development Environment, And Algorithms',
        'unit': 'Java concepts, setup, program structure, syntax, and algorithm design',
        'competencies': [
            'Discuss the fundamental concepts of Java.',
            'Perform the steps in setting up the development environment.',
            'Discuss Java basic structures and syntax.',
            'Develop algorithms for designing a program or system.',
        ],
        'overview': (
            'We learn Java concepts, prepare the development environment, read and write basic '
            'Java program structure, correct syntax errors, and design algorithms before coding.'
        ),
        'essential_question': 'How do programmers turn a problem into clear, testable instructions that Java can run?',
        'enduring_understanding': (
            'Strong programs begin with clear concepts, suitable tools, readable structure, correct '
            'syntax, and a logical plan that can be tested and improved.'
        ),
        'performance_task': (
            'Prepare and demonstrate a working Java environment, annotate a beginner Java program, '
            'correct its syntax errors, and design a tested algorithm for a simple problem.'
        ),
        'success_criteria': bullets(
            [
                'Java concepts and development tools are explained accurately.',
                'The environment runs a simple Java program successfully.',
                'Program parts and syntax corrections are clearly identified.',
                'The algorithm contains complete, ordered, and testable steps.',
                'The learner explains evidence from testing and revision.',
            ]
        ),
        'values_focus': (
            'Accuracy, patience during debugging, responsible tool use, persistence, and willingness '
            'to revise work based on evidence.'
        ),
    },
    {
        'key': 'program_design',
        'order': 2,
        'title': 'Program Design Using Flowcharts And Pseudocode',
        'unit': 'Visual and plain-language program planning',
        'competencies': [
            'Develop flowcharts for designing a program or system.',
            'Develop pseudocodes for designing a program or system.',
        ],
        'overview': (
            'We convert algorithms into flowcharts and pseudocode so program logic can be '
            'planned, traced, reviewed, and improved before Java coding.'
        ),
        'essential_question': 'How can visual and written plans make program logic easier to understand, test, and communicate?',
        'enduring_understanding': (
            'Flowcharts and pseudocode make invisible program logic visible, allowing programmers '
            'to find missing steps and weak decisions before writing code.'
        ),
        'performance_task': (
            'Design, trace, explain, and revise both a flowchart and pseudocode solution for a '
            'simple decision-based programming problem.'
        ),
        'success_criteria': bullets(
            [
                'Flowcharts use correct symbols, arrows, and branch labels.',
                'Pseudocode uses clear sequence, inputs, processes, outputs, and decisions.',
                'Both representations solve the same problem consistently.',
                'Sample values are used to trace and verify the logic.',
                'Revisions are explained using evidence from tracing or peer review.',
            ]
        ),
        'values_focus': (
            'Logical thinking, clarity in communication, careful review, constructive peer feedback, '
            'and accountability for correcting incomplete solutions.'
        ),
    },
    {
        'key': 'java_io',
        'order': 3,
        'title': 'Java Operators, Input, Output, And File Handling',
        'unit': 'Operators, expressions, user input, output formatting, and basic file I/O',
        'competencies': [
            'Apply operators in writing a Java program.',
            'Apply Java I/O classes to read and write data files in Java programs.',
        ],
        'overview': (
            'We use Java variables, data types, operators, expressions, user input, clean '
            'output, and basic file reading/writing to build beginner Java programs.'
        ),
        'essential_question': 'How can Java receive, process, display, and preserve information accurately and responsibly?',
        'enduring_understanding': (
            'Useful programs choose suitable data, apply correct operations, communicate clear '
            'results, and handle stored information carefully.'
        ),
        'performance_task': (
            'Create and explain a Student Information File program that reads user input, processes '
            'values, displays a clear summary, writes data to a file, and verifies the saved result.'
        ),
        'success_criteria': bullets(
            [
                'Variables and data types match the information being stored.',
                'Operators and expressions produce accurate results.',
                'Prompts and displayed output are clear and labeled.',
                'File writing and reading follow the required Java I/O steps.',
                'Testing evidence proves the console and file results are correct.',
            ]
        ),
        'values_focus': (
            'Accuracy, data responsibility, privacy awareness, readable communication, safe file '
            'handling, and honest reporting of test results.'
        ),
    },
]


LESSONS = [
    {
        'topic': 'fundamentals',
        'order': 1,
        'title': 'Lesson 1: Java Concepts And Real-World Programming',
        'focus': 'the purpose of Java, where Java is used, and why it is useful for beginners',
        'targets': [
            'Define Java in beginner-friendly language.',
            'Identify real-world systems where Java can be used.',
            'Explain why Java programs need code, tools, testing, and revision.',
        ],
        'terms': [
            'Java - a programming language used to create applications.',
            'Program - instructions a computer follows.',
            'Application - software that performs tasks for users.',
            'Developer - a person who designs, writes, tests, and improves programs.',
            'Output - result produced by a program.',
        ],
        'before': (
            'What apps or systems do you use every day? Which of them might need programming? '
            'List school systems, mobile apps, games, ATMs, websites, and enrollment tools.'
        ),
        'examples': [
            'A school grading system stores names, scores, and computed grades.',
            'A point-of-sale system records products, price, quantity, and total amount.',
            'A mobile app uses code to respond when the user taps a button.',
            'A simple Java program can display a message, compute a value, or save information.',
            'Java is often used in business systems, Android-related tools, enterprise applications, and learning projects.',
        ],
        'practice': [
            'Java Concepts Quick Map: create a concept map with Java at the center.',
            'Real-World Java Hunt: list five systems that might use programming logic.',
            'Vocabulary Match: match program, developer, application, and output to meanings.',
            'Explain It Simply: explain Java to a younger student.',
            'Think-Pair-Share: Why should programmers test their work?',
            'Exit Ticket: write three Java-related terms learned today.',
        ],
        'apply': [
            'Choose one daily system and describe its input, process, and output.',
            'Create a mini poster titled Java Around Us with four examples.',
            'Write a short paragraph explaining why Java is useful for learning programming.',
        ],
        'challenge': (
            'Design a one-page Java Concepts Quick Map showing at least eight connected ideas: '
            'Java, program, code, compiler, output, error, developer, and user.'
        ),
        'expected': [
            'A concept map with correct connections.',
            'Examples connect Java/programming to real systems.',
            'Student explanations mention instructions, output, or problem solving.',
        ],
        'misconceptions': [
            'Students may think Java and JavaScript are the same.',
            'Students may think programming is only typing code, not planning and testing.',
            'Students may think only games use programming.',
        ],
        'tips': [
            'Use familiar school and phone examples before technical definitions.',
            'Accept simple explanations first, then refine terms.',
            'Connect every concept to input, process, and output.',
        ],
        'subtopics': ['What Java is', 'Where Java is used', 'Programmer mindset', 'From problem to program'],
    },
    {
        'topic': 'fundamentals',
        'order': 2,
        'title': 'Lesson 2: Setting Up The Java Development Environment',
        'focus': 'the tools needed to write, compile, run, and test Java programs',
        'targets': [
            'Differentiate JDK, JRE, JVM, source code, and IDE.',
            'Follow the basic steps for preparing a Java development environment.',
            'Run a simple Java project or verify that Java is installed.',
        ],
        'terms': [
            'JDK - Java Development Kit used to build Java programs.',
            'JRE - Java Runtime Environment used to run Java applications.',
            'JVM - Java Virtual Machine that executes Java bytecode.',
            'IDE - software used to write and manage code.',
            'Compiler - tool that translates source code.',
        ],
        'before': 'If a carpenter needs tools to build a table, what tools does a programmer need to build a Java program?',
        'examples': [
            'JDK is like a toolbox for developing Java programs.',
            'IDE is like a workspace where files, errors, and output can be seen together.',
            'A version check confirms the computer recognizes Java.',
            'A new Java project contains folders and files that organize code.',
            'A successful test run prints a message without errors.',
        ],
        'practice': [
            'Java Tools Setup Check: identify whether JDK and IDE are installed.',
            'Version Check: record the Java version or IDE welcome screen.',
            'Tool Match: match JDK, IDE, compiler, and output window.',
            'First Project Test Run: create a new Java project and run a sample program.',
            'Screenshot Evidence: capture proof that Java ran successfully.',
            'Troubleshooting Log: list one setup issue and solution.',
        ],
        'apply': [
            'Create a setup checklist for a classmate.',
            'Run the Hello World sample and write what happened.',
            'Label a diagram showing source code, compiler, JVM, and output.',
        ],
        'challenge': (
            'Produce a Java Setup Confirmation Sheet with tool names, installation/status notes, '
            'a test-run result, and one troubleshooting tip.'
        ),
        'expected': [
            'Students identify JDK and IDE roles.',
            'A successful run displays simple output.',
            'Setup checklist is ordered and practical.',
        ],
        'misconceptions': [
            'Students may install only an IDE and forget the JDK.',
            'Students may confuse the code editor with the language itself.',
            'Students may panic at setup errors instead of reading messages.',
        ],
        'tips': [
            'Prepare screenshots for students with limited devices.',
            'Pair students so setup issues are solved collaboratively.',
            'Keep the first run simple; success matters more than complexity.',
        ],
        'subtopics': ['JDK, JRE, JVM', 'IDE setup', 'Checking Java version', 'Creating a first project'],
    },
    {
        'topic': 'fundamentals',
        'order': 3,
        'title': 'Lesson 3: Writing And Running A First Java Program',
        'focus': 'writing, running, and explaining a first Java output program',
        'targets': [
            'Type and run a simple Java program.',
            'Explain what the Hello World program displays.',
            'Modify a print statement to show personalized output.',
        ],
        'terms': [
            'Class - a named container for Java code.',
            'Main method - the starting point of a Java program.',
            'Statement - a single instruction.',
            'String - text enclosed in double quotation marks.',
            'Output - information displayed by a program.',
        ],
        'before': 'What message would you like your first program to display, and why?',
        'examples': [
            f'Hello World program:\n{HELLO_WORLD}',
            'Change the message to System.out.println("Welcome to Java!");',
            'Print two lines using two println statements.',
            'A missing quotation mark causes an error.',
            'Program output appears in the console or terminal.',
        ],
        'practice': [
            'Copy and run the Hello World program.',
            'Change the output message to your name and section.',
            'Add a second output line with your favorite subject.',
            'Predict the output before running the program.',
            'Compare print and println behavior.',
            'Mini Debug: fix a missing quotation mark.',
        ],
        'apply': [
            'Create a program that prints your name, course, and one goal.',
            'Write three output statements for a class announcement.',
            'Submit a screenshot or written copy of your output.',
        ],
        'challenge': (
            'Create a Welcome Program with at least five output lines: greeting, name, '
            'course, learning goal, and motivational message. Explain each line in one sentence.'
        ),
        'expected': [
            'Program runs without syntax errors.',
            'Output matches required lines.',
            'Student explains that println displays text.',
        ],
        'misconceptions': [
            'Students may forget quotation marks around text.',
            'Students may change class name but not file name when required.',
            'Students may not distinguish code from output.',
        ],
        'tips': [
            'Let students predict output before running code.',
            'Use errors as learning moments.',
            'Require explanation, not only screenshots.',
        ],
        'subtopics': ['Hello World', 'Print statements', 'Program output', 'Simple modification'],
    },
    {
        'topic': 'fundamentals',
        'order': 4,
        'title': 'Lesson 4: Java Program Structure And Code Comments',
        'focus': 'labeling and explaining the basic structure of a Java program',
        'targets': [
            'Identify class name, main method, statements, comments, and variables.',
            'Explain the purpose of each Java program part.',
            'Add comments to describe what code does.',
        ],
        'terms': [
            'Comment - note in code ignored by Java.',
            'Variable - named storage for a value.',
            'Method - block of code that performs a task.',
            'Brace - curly symbol used to group code blocks.',
            'Identifier - name used for classes, variables, or methods.',
        ],
        'before': 'Which parts of a short Java program look like names, actions, notes, or containers?',
        'examples': [
            'Label class name in public class StudentInfo.',
            'Label main method: public static void main(String[] args).',
            'Label variable declaration: String name = "Ana";',
            'Label a comment: // This displays the student name.',
            f'Full code walkthrough:\n{STUDENT_INFO}',
        ],
        'practice': [
            'Java Program Walk-Through: label class, main, statements, comments, variables.',
            'Color Code the Program.',
            'Comment the Code: add comments to explain three lines.',
            'Parts Matching: match Java part to its purpose.',
            'Explain to a Partner: describe what a variable stores.',
            'Code Labeling Quiz.',
        ],
        'apply': [
            'Write a Java program with at least two variables and two comments.',
            'Create a table: Java Part and Purpose.',
            "Exchange code and label each other's program.",
        ],
        'challenge': (
            'Submit an annotated Java program with class, main method, three variables, '
            'three output statements, and comments explaining each section.'
        ),
        'expected': [
            'Labels correctly identify class, main, variables, comments, statements.',
            'Comments explain purpose, not just repeat code.',
            'Annotated program is readable.',
        ],
        'misconceptions': [
            'Students may think comments run as code.',
            'Students may call every line a variable.',
            'Students may ignore braces and code block structure.',
        ],
        'tips': [
            'Use printed code for labeling before writing.',
            'Point to braces visually and show pairs.',
            'Accept simple but accurate explanations.',
        ],
        'subtopics': ['Class declaration', 'Main method', 'Statements', 'Comments', 'Variables'],
    },
    {
        'topic': 'fundamentals',
        'order': 5,
        'title': 'Lesson 5: Java Syntax Rules And Debugging Basics',
        'focus': 'recognizing Java syntax rules and correcting beginner errors',
        'targets': [
            'Identify common Java syntax errors.',
            'Correct missing semicolons, brackets, quotation marks, and wrong keywords.',
            'Explain why syntax rules matter.',
        ],
        'terms': [
            'Syntax - rules for writing valid code.',
            'Error - problem that prevents or affects execution.',
            'Semicolon - symbol that ends many Java statements.',
            'Brace - symbol used to group code.',
            'Debugging - finding and fixing errors.',
        ],
        'before': 'Why do sentences need punctuation? How is punctuation similar to syntax in programming?',
        'examples': [
            'Missing semicolon: System.out.println("Hi")',
            'Corrected line: System.out.println("Hi");',
            'Missing closing brace after main method.',
            'Wrong capitalization: system.out.println should be System.out.println.',
            'Missing quotation mark around text output.',
        ],
        'practice': [
            'Syntax Spot-the-Error: circle mistakes in five samples.',
            'Fix the Error Race: correct semicolons and braces.',
            'Capitalization Check.',
            'Quotation Mark Repair.',
            'Error Explanation: write why each correction is needed.',
            'Create an Error: write one wrong line for a partner to fix.',
        ],
        'apply': [
            'Correct a broken Hello World program with at least five errors.',
            'Make a personal Java Syntax Checklist.',
            'Write three beginner syntax rules.',
        ],
        'challenge': 'Debug a short Java program with at least eight errors. Submit corrected code and a correction log.',
        'expected': [
            'Common syntax errors are found and corrected.',
            'Correction log explains each fix.',
            'Corrected code runs or is logically valid.',
        ],
        'misconceptions': [
            'Students may fix by guessing without reading errors.',
            'Students may overlook uppercase/lowercase differences.',
            'Students may add random semicolons everywhere.',
        ],
        'tips': [
            'Teach students to read one error at a time.',
            'Use checklist: semicolon, quotes, braces, capitalization.',
            'Celebrate debugging as a programming skill.',
        ],
        'subtopics': ['Semicolons', 'Quotation marks', 'Braces', 'Capitalization', 'Debugging'],
    },
]

COMPACT_LESSONS = [
    ('algorithms', 6, 'Lesson 6: Algorithmic Thinking With Everyday Tasks', 'algorithms as ordered steps for completing familiar tasks', ['Define algorithm using daily-life examples.', 'Arrange steps in correct order.', 'Explain why order matters.'], ['Algorithm - ordered steps to solve a problem.', 'Step - one action in a process.', 'Sequence - correct order.', 'Input - information needed.', 'Output - result after steps.'], 'Describe how you log in to a computer. What happens if one step is skipped?', ['Logging in to a computer.', 'Making instant noodles.', 'Borrowing a library book.', 'Charging a phone safely.', 'Opening an IDE and creating a Java file.'], ['Everyday Steps to Algorithm.', 'Arrange the Algorithm.', 'Missing Step Detective.', 'Too Broad or Clear.', 'Partner Test.', 'Reflection Check.'], ['Write an algorithm for submitting an online assignment.', 'Create an algorithm for preparing your Java workspace.', 'Revise your algorithm after partner feedback.'], 'Create a clear 10-step algorithm for a daily school or computer task with title, input/materials, ordered steps, expected output, and one safety note.', ['Steps are ordered and specific.', 'Algorithm can be followed by another person.', 'Output/result is clear.'], ['Students may write paragraphs instead of steps.', 'Students may skip setup steps.', 'Students may confuse algorithm with final answer.'], ['Use physical routines before programming examples.', "Let classmates test each other's steps.", 'Ask: Could a beginner follow this exactly?'], ['Daily algorithms', 'Order and sequence', 'Input and output']),
    ('algorithms', 7, 'Lesson 7: Writing Algorithms With Input, Process, And Output', 'turning simple programming problems into clear ordered solutions', ['Identify input, process, and output.', 'Write ordered algorithm steps.', 'Revise vague steps into specific steps.'], ['Problem - task that needs a solution.', 'Input - values needed.', 'Process - computation performed.', 'Output - final result.', 'Revision - improving after checking.'], 'If the problem is display the sum of two numbers, what information must the program know first?', ['Sum of two numbers.', 'Find larger number.', 'Even or odd.', 'Average of three grades.', 'Temperature conversion.'], ['IPO Table.', 'Write the Algorithm.', 'Arrange the Algorithm.', 'Missing Step Detective.', 'Peer Review.', 'Improve the Algorithm.'], ['Write algorithms for area, total price, and pass/fail grade.', 'Explain one algorithm to a partner.', 'Create an IPO table before writing.'], 'Write three complete algorithms: sum of two numbers, larger of two numbers, and average of three grades. Each includes IPO and ordered steps.', ['Each algorithm includes input, process, output.', 'Steps are logical and complete.', 'Student explains calculation or decision.'], ['Students may compute before identifying inputs.', 'Students may forget output.', 'Students may combine too many actions in one unclear step.'], ['Require IPO before algorithm steps.', 'Use small numbers for checking.', 'Ask students to trace their own steps.'], ['IPO', 'Problem analysis', 'Step writing']),
    ('algorithms', 8, 'Lesson 8: Designing Algorithms For Simple Programming Problems', 'creating algorithms independently from given problem statements', ['Analyze a problem statement.', 'Create an algorithm that solves the problem.', 'Test an algorithm using sample values.'], ['Problem statement - description of what must be solved.', 'Test data - sample values used to check.', 'Logic - reasoning connecting steps.', 'Trace - manually follow steps.', 'Efficiency - solving without unnecessary steps.'], 'How do you know if your algorithm works before coding it?', ['Sum of 5 and 7 results 12.', 'Larger of 8 and 3 results 8.', 'Grade 75 is passing if passing mark is 75.', 'Total cost from price and quantity.', 'Positive, negative, or zero.'], ['Problem-to-Algorithm Challenge.', 'Trace Table.', 'Logic Check.', 'Rewrite Challenge.', 'Peer Debug.', 'Teacher Quick Check.'], ['Create algorithms for total fare, change from payment, and class average.', 'Write sample test data.', 'Revise one algorithm after tracing.'], 'Select one real-life numerical problem and write IPO, ordered steps, sample test data, trace, and expected output.', ['Algorithm solves selected problem.', 'Sample test proves logic.', 'Trace matches expected output.'], ['Students may not test algorithm.', 'Students may choose unclear problem statements.', 'Students may write code instead of steps.'], ['Model tracing slowly.', 'Require sample values.', 'Encourage revision.'], ['Problem analysis', 'Testing logic', 'Tracing']),
]

FLOWCHART_LESSONS = [
    (
        9,
        'Lesson 9: Flowchart Symbols And Program Logic',
        'recognizing standard flowchart symbols and choosing the correct shape for each program step',
        ['Identify terminal, process, input/output, decision, and flowline symbols.', 'Match program steps to the correct flowchart shape.', 'Explain why using the wrong symbol makes logic harder to read.'],
        ['Terminal - oval symbol for Start or End.', 'Process - rectangle for action or calculation.', 'Input/Output - parallelogram for receiving or displaying data.', 'Decision - diamond for a yes/no question.', 'Flowline - arrow showing direction.'],
        'If the step says grade >= 75?, should it be drawn as a rectangle or a diamond? Why?',
        ['Start and End terminals.', 'Input grade as a parallelogram.', 'average = total / 3 as a process rectangle.', 'grade >= 75? as a decision diamond.', 'Arrows that connect each step clearly.'],
        ['Symbol Sorting Drill.', 'Wrong Shape Correction.', 'Mini Flow Trace.', 'Symbol Choice Explanation.', 'Shape Memory Exit Ticket.'],
        ['Match each symbol to its purpose.', 'Correct wrong-symbol examples.', 'Explain the shape choice for five program steps.'],
        'Given ten program steps, choose the correct symbol for each one and explain three of your choices in complete sentences.',
        ['Each step is matched with the correct symbol.', 'Explanations connect the shape to the step purpose.', 'Student can trace a short Start-to-End flow.'],
        ['Students may memorize shapes without understanding purpose.', 'Students may put conditions in rectangles.', 'Students may forget that arrows are also part of the logic.'],
        ['Keep the lesson focused on symbol meaning, not full diagram design yet.', 'Ask students to justify every shape choice.', 'Use wrong examples so students practice correcting misconceptions.'],
        ['Terminal symbol', 'Process symbol', 'Input/output symbol', 'Decision symbol', 'Flowline arrows'],
    ),
    (
        10,
        'Lesson 10: Sequence Flowcharts For Program Design',
        'turning straight-line algorithms into top-to-bottom sequence flowcharts',
        ['Convert ordered algorithm steps into flowchart symbols.', 'Arrange a sequence flowchart with connected arrows.', 'Trace a sequence flowchart using sample input values.'],
        ['Sequence - steps followed in order without branching.', 'Top-to-bottom layout - readable arrangement for simple logic.', 'Connected arrow - flowline that points to the next step.', 'Trace - following the diagram with sample values.', 'IPO flow - input, process, output shown visually.'],
        'How can Start -> Input num1 and num2 -> Compute sum -> Display sum -> End become a flowchart?',
        ['Add Two Numbers sequence flowchart.', 'Area of Rectangle sequence flowchart.', 'Total Price sequence flowchart.', 'Numbered arrows for tracing.', 'Before-and-after algorithm-to-flowchart conversion.'],
        ['Algorithm To Diagram.', 'Arrow Direction Check.', 'IPO Labeling.', 'Total Price Flowchart.', 'Sequence Trace Exit Ticket.'],
        ['Convert a sum algorithm into a flowchart.', 'Create a total-price sequence flowchart.', 'Trace the diagram with sample values.'],
        'Create a clean top-to-bottom sequence flowchart for computing total price from price and quantity, then trace it with one sample input.',
        ['Steps follow a single clear sequence.', 'Correct symbols are used for input, process, and output.', 'Arrows are connected and easy to trace.'],
        ['Students may draw correct shapes but place them in confusing order.', 'Students may forget arrows between steps.', 'Students may add decision diamonds when no branching is needed.'],
        ['Start from an algorithm before drawing.', 'Require students to number arrows during tracing.', 'Emphasize clean vertical layout for simple sequences.'],
        ['Sequence flow', 'IPO conversion', 'Arrow direction', 'Tracing values', 'Layout clarity'],
    ),
    (
        11,
        'Lesson 11: Decision Flowcharts And Branching Logic',
        'drawing yes/no branches with decision diamonds and labeled paths',
        ['Write a condition that belongs inside a decision diamond.', 'Draw Yes and No branches from a decision.', 'Trace both branches using different sample values.'],
        ['Condition - question that can be answered yes or no.', 'Branch - path followed after a decision.', 'Yes path - route when the condition is true.', 'No path - route when the condition is false.', 'Branch label - text that identifies each outgoing arrow.'],
        'What should happen when grade is 90? What should happen when grade is 70?',
        ['Pass or Try Again decision flowchart.', 'Even or Odd decision question.', 'Age eligibility branch.', 'Missing Yes/No labels correction.', 'Two-value branch trace.'],
        ['Decision Question Builder.', 'Pass/Fail Flowchart.', 'Trace Two Branches.', 'Missing Branch Label Fix.', 'Branch Logic Exit Ticket.'],
        ['Write decision questions.', 'Draw a pass/fail branch flowchart.', 'Trace one passing and one failing value.'],
        'Draw a pass/fail decision flowchart for a grade, label both branches, and submit trace notes for grade = 90 and grade = 70.',
        ['Decision question is placed in a diamond.', 'Both Yes and No branches are labeled.', 'Each branch leads to the correct output and reaches End.'],
        ['Students may leave branch arrows unlabeled.', 'Students may draw only the passing path.', 'Students may confuse the condition result with the displayed output.'],
        ['Require two traces, one for each branch.', 'Read branch labels aloud while tracing.', 'Check that every path reaches End.'],
        ['Decision diamond', 'Condition', 'Yes branch', 'No branch', 'Branch tracing'],
    ),
    (
        12,
        'Lesson 12: Flowcharting Simple Programming Problems',
        'combining sequence and decision logic into a complete problem-solving flowchart',
        ['Analyze a full programming problem before drawing.', 'Combine input, process, decision, output, and end symbols.', 'Test and revise a complete flowchart with sample values.'],
        ['Problem flowchart - complete visual plan for a program.', 'Average - computed value from several numbers.', 'Combined logic - sequence plus decision in one diagram.', 'Test path - route followed by one sample input set.', 'Revision - improving layout or logic after checking.'],
        'How would we draw a complete Average Grade Calculator from input to final pass/fail output?',
        ['Average Grade Calculator full flowchart.', 'Passing sample trace: 90, 85, 80.', 'Failing sample trace: 70, 72, 74.', 'Peer review checklist.', 'Revised final flowchart.'],
        ['Problem Analysis.', 'Full Flowchart Build.', 'Sample Grade Trace.', 'Peer Review Checklist.', 'Revision Reflection.'],
        ['Plan the IPO for average grade.', 'Draw a complete flowchart with sequence and decision logic.', 'Revise after tracing two sample grade sets.'],
        'Create the complete Average Grade Calculator flowchart with input, average computation, pass/fail decision, outputs, End, two traces, and one revision note.',
        ['Flowchart solves the full problem.', 'Sequence and decision symbols are used correctly.', 'Both passing and failing traces are shown.', 'Revision improves clarity or correctness.'],
        ['Students may skip problem analysis and start drawing randomly.', 'Students may compute average but forget the decision.', 'Students may not test both passing and failing cases.'],
        ['Require IPO notes before the diagram.', 'Use two sample grade sets to test completeness.', 'Grade the revision note so students value checking.'],
        ['Problem analysis', 'Average computation', 'Combined logic', 'Two-path testing', 'Revision'],
    ),
]

for compact in FLOWCHART_LESSONS:
    order, title, focus, targets, terms, before, examples, practice, apply, challenge, expected, misconceptions, tips, subtopics = compact
    COMPACT_LESSONS.append(('flowcharts', order, title, focus, targets, terms, before, examples, practice, apply, challenge, expected, misconceptions, tips, subtopics))

for order, title in [
    (13, 'Lesson 13: Pseudocode Fundamentals For Program Planning'),
    (14, 'Lesson 14: Pseudocode With Input, Process, And Output'),
    (15, 'Lesson 15: Pseudocode With Decisions And Branches'),
    (16, 'Lesson 16: Pseudocode Review, Fix-It, And Revision'),
]:
    COMPACT_LESSONS.append(('pseudocode', order, title, 'plain-English program planning before Java coding', ['Write readable pseudocode.', 'Use input, process, output, and decisions when needed.', 'Revise pseudocode so the logic is complete.'], ['Pseudocode - plain-language program plan.', 'INPUT - receive data.', 'SET - assign or compute value.', 'DISPLAY - show result.', 'IF/ELSE - decision structure.'], 'Why might programmers write a plan before writing Java code?', ['START, DISPLAY Hello, END.', 'Sum of two numbers pseudocode.', 'Average grade pseudocode.', 'Pass/fail pseudocode.', 'Broken pseudocode correction.'], ['Identify Pseudocode.', 'Algorithm to Pseudocode.', 'Complete Missing Lines.', 'Trace with Values.', 'Pseudocode Fix-It Task.', 'Correction Log.'], ['Write pseudocode for area of rectangle.', 'Write pseudocode for grade status.', 'Exchange and revise with a partner.'], 'Correct broken pseudocode for computing average grade and pass/fail status, then submit a revision log.', ['Pseudocode is readable and ordered.', 'Logic is complete.', 'Revision log explains changes.'], ['Students may write Java code instead.', 'Students may use inconsistent variable names.', 'Students may skip tracing.'], ['Allow flexible wording but require clarity.', 'Use indentation for decisions.', 'Grade explanation as well as correction.'], ['Pseudocode keywords', 'IPO', 'IF/ELSE', 'Revision']))

for order, title in [
    (17, 'Lesson 17: Java Variables And Data Types'),
    (18, 'Lesson 18: Arithmetic And Assignment Operators In Java'),
    (19, 'Lesson 19: Comparison And Logical Operators In Java'),
    (20, 'Lesson 20: Building And Tracing Java Expressions'),
]:
    COMPACT_LESSONS.append(('operators', order, title, 'using variables, data types, and operators to build Java expressions', ['Choose suitable data types.', 'Use arithmetic, assignment, comparison, or logical operators.', 'Predict and explain expression results.'], ['Variable - named storage.', 'Data type - kind of value.', 'Operator - symbol that performs an action.', 'Expression - code that produces a value.', 'Boolean expression - true/false result.'], 'What information about a student can a program store, and what operation might the program perform on it?', ['String name = "Ana"; int age = 18;', 'int sum = 5 + 7;', 'average = (g1 + g2 + g3) / 3.0;', 'grade >= 75.', 'age >= 18 && registered == true.'], ['Identify the Data Type.', 'Predict the Output.', 'Fix the Operator Error.', 'Complete the Java Expression.', 'Simple Calculator Practice.', 'Trace Boolean Results.'], ['Create variables for a student profile.', 'Write expressions for area, total price, and average.', 'Explain one expression step by step.'], 'Build a Grade Status Checker expression set: compute average, determine passing status, and display the result.', ['Correct data types and operators.', 'Expression results are accurate.', 'Student can explain calculations or conditions.'], ['Students may use String for every value.', 'Students may confuse = and ==.', 'Students may ignore operator precedence.'], ['Use trace tables.', 'Show math beside Java expressions.', 'Test boundary values like 75.'], ['Variables', 'Data types', 'Operators', 'Expressions']))

for order, title, extra in [
    (21, 'Lesson 21: Reading User Input With Scanner', SCANNER_EXAMPLE),
    (22, 'Lesson 22: Formatting Clear Java Program Output', 'System.out.println("Name: " + name);'),
    (23, 'Lesson 23: Writing Text Data To Files In Java', WRITE_FILE_EXAMPLE),
    (24, 'Lesson 24: Reading Text Data From Files In Java', READ_FILE_EXAMPLE),
    (25, 'Lesson 25: Mini Project - Student Information File Program', 'Combine Scanner input, formatted output, FileWriter, testing, and explanation.'),
]:
    COMPACT_LESSONS.append(('io', order, title, 'reading input, displaying output, and saving or reading simple text files', ['Use Java I/O concepts appropriately.', 'Create readable program output.', 'Test and explain input/output or file behavior.'], ['Scanner - Java class for input.', 'Prompt - message asking for input.', 'Output formatting - arranging results clearly.', 'FileWriter - class for writing text.', 'File - stored data on a computer.'], 'Why is a program more useful if it can ask, display, save, or read information?', [extra, 'Read a name and display a greeting.', 'Display labeled grade report output.', 'Save student information to student.txt.', 'Read and display file contents.'], ['Input Practice.', 'Output Formatting Practice.', 'File I/O Concept Check.', 'Trace File Writing Steps.', 'Read Student Info from a File.', 'Peer Test and Feedback.'], ['Create a student introduction program.', 'Create a receipt or grade report output.', 'Save and/or read student information from a text file.'], 'Create a Student Information File Java program that reads user input, displays a clean summary, saves the information to a text file, and includes a written explanation.', ['Program reads required input.', 'Program displays clean output.', 'Program saves or reads a text file.', 'Student provides evidence and explanation.'], ['Students may forget import statements.', 'Students may display unlabeled values.', 'Students may submit code without file evidence.'], ['Use clear prompts.', 'Show exact file location.', 'Require screenshot/output and short explanation.'], ['Scanner', 'Output formatting', 'File writing', 'File reading']))


def topic_key_for_category(category):
    if category in ('fundamentals', 'algorithms'):
        return 'fundamentals'
    if category in ('flowcharts', 'pseudocode'):
        return 'program_design'
    return 'java_io'


for compact in COMPACT_LESSONS:
    category, order, title, focus, targets, terms, before, examples, practice, apply, challenge, expected, misconceptions, tips, subtopics = compact
    LESSONS.append(
        {
            'topic': topic_key_for_category(category),
            'category': category,
            'order': order,
            'title': title,
            'focus': focus,
            'targets': targets,
            'terms': terms,
            'before': before,
            'examples': examples,
            'practice': practice,
            'apply': apply,
            'challenge': challenge,
            'expected': expected,
            'misconceptions': misconceptions,
            'tips': tips,
            'subtopics': subtopics,
        }
    )


class Command(BaseCommand):
    help = 'Import or update the CC 102 foundational Java lesson pack.'

    def handle(self, *args, **options):
        subject = self.upsert_subject()
        module = self.upsert_module(subject)
        topic_map = self.upsert_topics(module)
        self.upsert_lessons(topic_map)
        self.stdout.write(self.style.SUCCESS('CC 102 import complete.'))
        self.stdout.write(f'Subject: {subject.id} {subject.code} - {subject.name}')
        self.stdout.write(f'Module: {module.id} {module.title}')
        self.stdout.write(f'Topics: {ModuleTopic.objects.filter(module=module).count()}')
        self.stdout.write(f'Lessons: {ModuleLesson.objects.filter(topic__module=module).count()}')
        for topic in ModuleTopic.objects.filter(module=module).order_by('order'):
            self.stdout.write(f'- {topic.order}. {topic.title}: {topic.lessons.count()} lessons')

    def upsert_subject(self):
        subject, _ = Subject.objects.update_or_create(
            code='CC 102',
            defaults={
                'name': 'Computer Programming / Java Programming',
                'description': (
                    'A foundational Java programming module covering Java concepts, development '
                    'environment setup, program structure and syntax, algorithms, flowcharts, '
                    'pseudocode, operators, user input, output, and basic file handling.'
                ),
                'is_active': True,
            },
        )
        return subject

    def upsert_module(self, subject):
        module = getattr(subject, 'learning_module', None)
        if module is None:
            module, _ = Module.objects.get_or_create(
                slug='cc-102-java-programming-module',
                defaults={'subject': subject},
            )

        module.title = 'CC 102 Java Programming Module'
        module.slug = module.slug or 'cc-102-java-programming-module'
        module.subject = subject
        module.description = subject.description
        module.learning_objectives = bullets(
            [
                'Explain fundamental Java concepts and the role of Java tools.',
                'Set up and test a Java development environment.',
                'Read, label, and write basic Java program structures.',
                'Design algorithms, flowcharts, and pseudocode before coding.',
                'Use variables, data types, and operators to solve beginner programming problems.',
                'Read input, display clear output, and use basic file input/output in Java.',
            ]
        )
        module.lesson_overview = (
            'This module is a foundational CC 102 Java programming learning pack. Lessons move '
            'from Java concepts and setup, to program structure and syntax, algorithmic thinking, '
            'flowcharts, pseudocode, Java expressions, input/output, and basic file handling.'
        )
        module.resources = (
            'Reference inspiration: TLE-ICT ReEcho Hub MATATAG-aligned workflow. Suggested tools: JDK, '
            'IntelliJ IDEA Community Edition or VS Code with Java extensions, Java documentation, printed '
            'flowchart guides, worksheets, and sample code snippets.'
        )
        module.is_paid = False
        module.price = '0.00'
        module.is_published = True
        module.save()
        module.subjects.add(subject)
        return module

    def upsert_topics(self, module):
        topic_map = {}
        kept_topic_ids = []
        for item in TOPICS:
            topic, _ = ModuleTopic.objects.update_or_create(
                module=module,
                title=item['title'],
                defaults={
                    'order': item['order'],
                    'competency_code': f'CC102-T{item["order"]}',
                    'competency_text': bullets(item['competencies']),
                    'unit': item['unit'],
                    'overview': item['overview'],
                    'essential_question': item['essential_question'],
                    'enduring_understanding': item['enduring_understanding'],
                    'performance_task': item['performance_task'],
                    'success_criteria': item['success_criteria'],
                    'values_focus': item['values_focus'],
                    'is_published': True,
                },
            )
            topic_map[item['key']] = topic
            kept_topic_ids.append(topic.id)
        ModuleTopic.objects.filter(module=module).exclude(id__in=kept_topic_ids).delete()
        return topic_map

    def upsert_lessons(self, topic_map):
        for item in LESSONS:
            topic = topic_map[item['topic']]
            lesson, _ = ModuleLesson.objects.update_or_create(
                topic=topic,
                title=item['title'],
                defaults=self.lesson_defaults(item),
            )
            self.upsert_lesson_examples(lesson, item)

    def upsert_lesson_examples(self, lesson, item):
        examples = lesson_examples_for(item)
        if not examples:
            return

        kept_ids = []
        for example in examples:
            record, _ = ModuleLessonExample.objects.update_or_create(
                lesson=lesson,
                title=example['title'],
                defaults={
                    'order': example['order'],
                    'alt_text': example['alt_text'],
                    'body': example['body'],
                    'common_mistake': example['common_mistake'],
                    'mini_check': example['mini_check'],
                    'is_published': True,
                },
            )
            svg = flowchart_example_svg(example['title'], example['steps'])
            record.image.save(
                example['filename'],
                ContentFile(svg.encode('utf-8')),
                save=True,
            )
            kept_ids.append(record.id)

        lesson.lesson_examples.exclude(id__in=kept_ids).delete()

    def lesson_defaults(self, item):
        return {
            'order': item['order'],
            'learning_targets': 'By the end of this lesson, we can:\n'
            + bullets(item['targets']),
            'key_terms': bullets(item['terms']),
            'before_you_start': item['before'],
            'short_discussion': detailed_discussion(item),
            'guided_examples': guided_examples_for(item),
            'lets_practice': detailed_practice_for(item),
            'apply_what_you_learned': 'Now we apply it through these tasks:\n'
            + numbered(item['apply']),
            'challenge_task': item['challenge'],
            'rubric': COMMON_RUBRIC,
            'reflection': "Let's reflect:\n"
            + bullets(
                [
                    'What concept from this lesson is clearest to you now?',
                    'What mistake did you notice or correct during practice?',
                    'Which activity helped you understand the lesson best?',
                    'How can this skill help you design or write a Java program?',
                    'What do you still need to practice before the next lesson?',
                ]
            ),
            'evidence_of_learning': lesson_evidence(item),
            'objectives': bullets(item['targets']),
            'overview': (
                f'This lesson develops beginner understanding of {item["focus"]} through examples, '
                'practice, application, and reflection.'
            ),
            'subtopics': bullets(item['subtopics']),
            'acquisition': (
                'Students acquire the lesson by studying key terms, teacher-modeled examples, guided '
                'code or logic walkthroughs, and short checks for understanding.'
            ),
            'making_meaning': (
                'Students make meaning by explaining why each step, symbol, syntax rule, or Java '
                'statement is needed and by comparing correct and incorrect examples.'
            ),
            'transfer': (
                'Students transfer learning by completing an independent task that applies the concept '
                'to a new but simple programming situation.'
            ),
            'examples': '\n'.join(item['examples']),
            'teacher_notes': 'Teacher guide:\n' + bullets(item['tips']),
            'answer_key': 'Suggested answers / checking guide:\n' + bullets(item['expected']),
            'expected_outputs': 'Expected outputs or evidence:\n' + bullets(item['expected']),
            'common_misconceptions': 'Common misconceptions to watch for:\n'
            + bullets(item['misconceptions']),
            'teaching_tips': 'Teaching tips:\n' + bullets(item['tips']),
            'remediation': lesson_remediation(item),
            'enrichment': lesson_enrichment(item),
            'student_activities': '\n'.join(item['practice'] + item['apply']),
            'resources': (
                'JDK, IDE, projector or screenshots, printed worksheets, notebook, sample code snippets, '
                'and teacher-created answer guides.'
            ),
            'assessment_url': '',
            'is_published': True,
        }
