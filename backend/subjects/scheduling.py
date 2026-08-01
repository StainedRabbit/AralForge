import re


WEEKDAY_CODES = ('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU')

DAY_ALIASES = {
    'M': 'MO',
    'MO': 'MO',
    'MON': 'MO',
    'MONDAY': 'MO',
    'T': 'TU',
    'TU': 'TU',
    'TUE': 'TU',
    'TUES': 'TU',
    'TUESDAY': 'TU',
    'W': 'WE',
    'WE': 'WE',
    'WED': 'WE',
    'WEDNESDAY': 'WE',
    'R': 'TH',
    'TH': 'TH',
    'THU': 'TH',
    'THUR': 'TH',
    'THURS': 'TH',
    'THURSDAY': 'TH',
    'F': 'FR',
    'FR': 'FR',
    'FRI': 'FR',
    'FRIDAY': 'FR',
    'S': 'SA',
    'SA': 'SA',
    'SAT': 'SA',
    'SATURDAY': 'SA',
    'SU': 'SU',
    'SUN': 'SU',
    'SUNDAY': 'SU',
}


def parse_schedule_days(value):
    text = str(value or '').strip().upper()
    if not text:
        raise ValueError('Select at least one meeting day.')

    if re.search(r'[\s,;/|-]', text):
        tokens = [token for token in re.split(r'[\s,;/|-]+', text) if token]
    elif text in DAY_ALIASES:
        tokens = [text]
    else:
        tokens = _scan_compact_days(text)

    try:
        selected = {DAY_ALIASES[token] for token in tokens}
    except KeyError as error:
        raise ValueError(f'Unrecognized meeting day: {error.args[0]}.') from error

    return tuple(code for code in WEEKDAY_CODES if code in selected)


def normalize_schedule_days(value):
    return ','.join(parse_schedule_days(value))


def schedules_share_day(left, right):
    return bool(set(parse_schedule_days(left)) & set(parse_schedule_days(right)))


def _scan_compact_days(text):
    tokens = []
    index = 0
    while index < len(text):
        pair = text[index:index + 2]
        if pair in {'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'}:
            tokens.append(pair)
            index += 2
            continue
        character = text[index]
        if character not in {'M', 'T', 'W', 'R', 'F', 'S'}:
            raise ValueError(f'Unrecognized meeting days: {text}.')
        tokens.append(character)
        index += 1
    return tokens
