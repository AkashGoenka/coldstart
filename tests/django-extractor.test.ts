import { describe, it, expect, beforeAll } from 'vitest';
import { parsePythonContent } from '../src/indexer/extractors/python.js';
import { ensureParsersReady } from '../src/indexer/extractors/parser-factory.js';

// Direct extractor calls (not via parseFile) must load the wasm grammars first.
beforeAll(async () => { await ensureParsersReady(); });

describe('Django extractor — settings.py references', () => {
  it('extracts MIDDLEWARE list string references', () => {
    const content = `
MIDDLEWARE = [
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.security.SecurityMiddleware',
]
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('django.middleware.locale.LocaleMiddleware');
    expect(refs.map(r => r.value)).toContain('django.middleware.security.SecurityMiddleware');
  });

  it('extracts AUTHENTICATION_BACKENDS references', () => {
    const content = `
AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'django_extensions.auth.CustomBackend',
]
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('django.contrib.auth.backends.ModelBackend');
    expect(refs.map(r => r.value)).toContain('django_extensions.auth.CustomBackend');
  });

  it('extracts ROOT_URLCONF single string reference', () => {
    const content = `
ROOT_URLCONF = 'myapp.urls'
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('myapp.urls');
  });

  it('extracts WSGI_APPLICATION single string reference', () => {
    const content = `
WSGI_APPLICATION = 'config.wsgi.application'
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('config.wsgi.application');
  });

  it('extracts ASGI_APPLICATION single string reference', () => {
    const content = `
ASGI_APPLICATION = 'config.asgi.application'
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('config.asgi.application');
  });

  it('extracts strings from LOGGING dict', () => {
    const content = `
LOGGING = {
    'version': 1,
    'handlers': {
        'mail_admins': {
            'class': 'django.utils.log.AdminEmailHandler',
            'level': 'ERROR',
        },
        'console': {
            'class': 'logging.StreamHandler',
        },
    },
    'loggers': {
        'django.request': {
            'handlers': ['mail_admins'],
            'level': 'ERROR',
        },
    },
}
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    const values = refs.map(r => r.value);
    expect(values).toContain('django.utils.log.AdminEmailHandler');
    expect(values).toContain('logging.StreamHandler');
  });

  it('extracts strings from TEMPLATES list of dicts', () => {
    const content = `
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
            ],
        },
    },
]
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    const values = refs.map(r => r.value);
    expect(values).toContain('django.template.backends.django.DjangoTemplates');
    expect(values).toContain('django.template.context_processors.debug');
    expect(values).toContain('django.template.context_processors.request');
  });
});

describe('Django extractor — urls.py references', () => {
  it('extracts include() calls with string arguments', () => {
    const content = `
from django.urls import path, include

urlpatterns = [
    path('api/', include('myapp.api.urls')),
    path('admin/', include('admin.urls')),
]
`;
    const result = parsePythonContent(content, 'urls.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('myapp.api.urls');
    expect(refs.map(r => r.value)).toContain('admin.urls');
  });

  it('does NOT extract non-literal include() arguments', () => {
    const content = `
from django.urls import include

urlpatterns = [
    path('api/', include(api_urls_var)),
    path('other/', include(f'prefix.{module}')),
]
`;
    const result = parsePythonContent(content, 'urls.py');
    const refs = result.djangoConventionRefs ?? [];
    const values = refs.map(r => r.value);
    // Should only extract literal strings
    expect(values).not.toContain('api_urls_var');
  });
});

describe('Django extractor — importlib references', () => {
  it('extracts importlib.import_module() with literal strings', () => {
    const content = `
import importlib

middleware_class = importlib.import_module('django.middleware.locale')
backend = importlib.import_module('django.contrib.auth.backends')
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    const values = refs.map(r => r.value);
    expect(values).toContain('django.middleware.locale');
    expect(values).toContain('django.contrib.auth.backends');
  });

  it('does NOT extract importlib.import_module() with non-literal args', () => {
    const content = `
import importlib

module_name = 'django.middleware.locale'
middleware_class = importlib.import_module(module_name)
backend = importlib.import_module(get_backend_path())
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    // Should only have references from literal strings, not variables
    const values = refs.map(r => r.value);
    expect(values).not.toContain('module_name');
  });
});

describe('Django extractor — edge cases', () => {
  it('handles single and double quotes', () => {
    const content = `
MIDDLEWARE = [
    'django.middleware.locale.LocaleMiddleware',
    "django.middleware.security.SecurityMiddleware",
]
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    expect(refs.map(r => r.value)).toContain('django.middleware.locale.LocaleMiddleware');
    expect(refs.map(r => r.value)).toContain('django.middleware.security.SecurityMiddleware');
  });

  it('deduplicates duplicate references', () => {
    const content = `
MIDDLEWARE = [
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.locale.LocaleMiddleware',
]
`;
    const result = parsePythonContent(content, 'settings.py');
    const refs = result.djangoConventionRefs ?? [];
    const count = refs.filter(r => r.value === 'django.middleware.locale.LocaleMiddleware').length;
    expect(count).toBe(1);
  });

  it('returns undefined when no Django convention references', () => {
    const content = `
def hello():
    return "world"
`;
    const result = parsePythonContent(content, 'other.py');
    expect(result.djangoConventionRefs).toBeUndefined();
  });

  it('returns empty array converted to undefined for consistency', () => {
    const content = `
REGULAR_SETTING = 123
`;
    const result = parsePythonContent(content, 'settings.py');
    expect(result.djangoConventionRefs).toBeUndefined();
  });
});
