import hashlib
from urllib.parse import urlparse


CANONICAL_STORAGE_ENV = {
    'endpoint': 'OBJECT_STORAGE_S3_ENDPOINT',
    'region': 'OBJECT_STORAGE_S3_REGION',
    'access_key': 'OBJECT_STORAGE_S3_ACCESS_KEY_ID',
    'secret_key': 'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY',
    'bucket': 'OBJECT_STORAGE_BUCKET',
}

LEGACY_STORAGE_ENV = {
    'endpoint': 'SUPABASE_S3_ENDPOINT',
    'region': 'SUPABASE_S3_REGION',
    'access_key': 'SUPABASE_S3_ACCESS_KEY_ID',
    'secret_key': 'SUPABASE_S3_SECRET_ACCESS_KEY',
    'bucket': 'SUPABASE_STORAGE_BUCKET',
}


def resolve_object_storage_config(environ, *, required=False):
    """Resolve one complete R2 variable family without exposing its secrets."""
    canonical_present = _present_names(environ, CANONICAL_STORAGE_ENV)
    legacy_present = _present_names(environ, LEGACY_STORAGE_ENV)

    if canonical_present and legacy_present:
        raise RuntimeError(
            'Object storage configuration mixes OBJECT_STORAGE_* and '
            'SUPABASE_* variables. Configure exactly one complete variable family.'
        )

    if canonical_present:
        source = 'OBJECT_STORAGE'
        names = CANONICAL_STORAGE_ENV
    elif legacy_present:
        source = 'SUPABASE'
        names = LEGACY_STORAGE_ENV
    elif required:
        raise RuntimeError(
            'Missing required production object storage configuration: '
            + ', '.join(CANONICAL_STORAGE_ENV.values())
        )
    else:
        return None

    missing = [name for name in names.values() if not _env_value(environ, name)]
    if missing:
        raise RuntimeError(
            f'Incomplete {source} object storage configuration; missing: '
            + ', '.join(sorted(missing))
        )

    config = {
        key: _env_value(environ, name)
        for key, name in names.items()
    }
    config['source'] = source
    _validate_r2_config(config)
    config['endpoint'] = config['endpoint'].rstrip('/')
    return config


def object_storage_summary(config):
    if not config:
        return None
    return {
        'source': config['source'],
        'endpoint_host': urlparse(config['endpoint']).hostname,
        'region': config['region'],
        'bucket': config['bucket'],
        'access_key_fingerprint': hashlib.sha256(
            config['access_key'].encode('utf-8')
        ).hexdigest()[:12],
    }


def safe_exception_message(error):
    """Return useful botocore diagnostics without serializing request details."""
    response = getattr(error, 'response', None)
    operation = getattr(error, 'operation_name', None)
    if not isinstance(response, dict) or not operation:
        return str(error)[:4000]

    error_fields = response.get('Error') or {}
    metadata = response.get('ResponseMetadata') or {}
    details = [f'operation={_single_line(operation)}']
    if error_fields.get('Code'):
        details.append(f'code={_single_line(error_fields["Code"])}')
    if metadata.get('HTTPStatusCode') is not None:
        details.append(f'http_status={metadata["HTTPStatusCode"]}')
    if metadata.get('RequestId'):
        details.append(f'request_id={_single_line(metadata["RequestId"])}')

    message = _single_line(error_fields.get('Message', ''))
    prefix = f'Object storage request failed ({", ".join(details)})'
    return f'{prefix}: {message}'[:4000] if message else prefix[:4000]


def _present_names(environ, names):
    return [name for name in names.values() if _env_value(environ, name)]


def _env_value(environ, name):
    return str(environ.get(name, '')).strip()


def _validate_r2_config(config):
    endpoint = urlparse(config['endpoint'])
    if (
        endpoint.scheme != 'https'
        or not endpoint.hostname
        or not endpoint.hostname.endswith('.r2.cloudflarestorage.com')
        or endpoint.username
        or endpoint.password
        or endpoint.port
        or endpoint.path not in {'', '/'}
        or endpoint.params
        or endpoint.query
        or endpoint.fragment
    ):
        raise RuntimeError(
            'Object storage endpoint must be the R2 account endpoint '
            'https://<ACCOUNT_ID>.r2.cloudflarestorage.com with no bucket path.'
        )
    if config['region'].lower() != 'auto':
        raise RuntimeError('Cloudflare R2 object storage region must be auto.')


def _single_line(value):
    return ' '.join(str(value).split())[:512]
