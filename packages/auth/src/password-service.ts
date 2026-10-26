import { D1Store } from '@gongyu/data/d1-store';
import { Clock, Effect, Schema } from 'effect';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;
export const MIN_PASSWORD_LENGTH = 8;

class PasswordRow extends Schema.Class<PasswordRow>('PasswordRow')({
    passwordHash: Schema.String,
}) {}

class CountRow extends Schema.Class<CountRow>('CountRow')({
    count: Schema.Number,
}) {}

export class PasswordError extends Schema.TaggedErrorClass<PasswordError>()(
    'PasswordError',
    {
        cause: Schema.optionalKey(Schema.Unknown),
        code: Schema.String,
        message: Schema.String,
    },
) {}

function makePasswordError(
    code: string,
    message: string,
    cause?: unknown,
): PasswordError {
    return PasswordError.make({
        code,
        message,
        ...(cause === undefined ? {} : { cause }),
    });
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

const deriveBits = Effect.fn('Password.deriveBits')(function* (input: {
    readonly iterations: number;
    readonly password: string;
    readonly salt: Uint8Array;
}) {
    const encoded = new TextEncoder().encode(input.password);
    const raw = new Uint8Array(encoded);
    const key = yield* Effect.tryPromise({
        try: () =>
            crypto.subtle.importKey(
                'raw',
                raw.buffer as ArrayBuffer,
                'PBKDF2',
                false,
                ['deriveBits'],
            ),
        catch: (cause) =>
            makePasswordError(
                'hash_failed',
                'The password could not be hashed.',
                cause,
            ),
    });
    const bits = yield* Effect.tryPromise({
        try: () =>
            crypto.subtle.deriveBits(
                {
                    hash: 'SHA-256',
                    iterations: input.iterations,
                    name: 'PBKDF2',
                    salt: input.salt.buffer as ArrayBuffer,
                },
                key,
                PBKDF2_KEY_LENGTH_BITS,
            ),
        catch: (cause) =>
            makePasswordError(
                'hash_failed',
                'The password could not be hashed.',
                cause,
            ),
    });
    return new Uint8Array(bits);
});

function hashPrefix(iterations: number): string {
    return `pbkdf2-sha256$${iterations}$`;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
    let difference = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
    }
    return difference === 0;
}

export const hasPassword = Effect.fn('Password.hasPassword')(function* () {
    const d1Store = yield* D1Store;
    const row = yield* d1Store.first(
        CountRow,
        'SELECT COUNT(*) AS count FROM admin_password',
    );
    return (row?.count ?? 0) > 0;
});

export const setupPassword = Effect.fn('Password.setupPassword')(function* (
    password: string,
) {
    if (password.length < MIN_PASSWORD_LENGTH) {
        return yield* Effect.fail(
            makePasswordError(
                'weak_password',
                `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`,
            ),
        );
    }

    const d1Store = yield* D1Store;
    const now = yield* Clock.currentTimeMillis;
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    const derived = yield* deriveBits({
        iterations: PBKDF2_ITERATIONS,
        password,
        salt,
    });
    const hash = `${hashPrefix(PBKDF2_ITERATIONS)}${toBase64(salt)}$${toBase64(derived)}`;
    yield* d1Store
        .run(
            `
                INSERT INTO admin_password (
                    singleton_id,
                    password_hash,
                    created_at,
                    updated_at
                )
                VALUES (1, ?, ?, ?)
            `,
            [hash, now, now],
        )
        .pipe(
            Effect.mapError((error) =>
                error.message.includes('UNIQUE constraint failed')
                    ? makePasswordError(
                          'password_already_set',
                          '管理员密码已设置。',
                      )
                    : error,
            ),
        );
    return { setup: true as const };
});

export const verifyPassword = Effect.fn('Password.verifyPassword')(function* (
    password: string,
) {
    const d1Store = yield* D1Store;
    const row = yield* d1Store.first(
        PasswordRow,
        'SELECT password_hash AS "passwordHash" FROM admin_password WHERE singleton_id = 1',
    );
    if (row === null) {
        return yield* Effect.fail(
            makePasswordError(
                'not_registered',
                '尚未设置管理员密码。',
            ),
        );
    }

    const segments = row.passwordHash.split('$');
    if (segments.length !== 4 || segments[0] !== 'pbkdf2-sha256') {
        return yield* Effect.fail(
            makePasswordError(
                'stored_hash_invalid',
                '存储的密码哈希无效。',
            ),
        );
    }
    const iterations = Number.parseInt(segments[1] ?? '', 10);
    const salt = fromBase64(segments[2] ?? '');
    const expected = fromBase64(segments[3] ?? '');
    if (!Number.isFinite(iterations) || iterations < 1) {
        return yield* Effect.fail(
            makePasswordError(
                'stored_hash_invalid',
                '存储的密码哈希无效。',
            ),
        );
    }

    const derived = yield* deriveBits({
        iterations,
        password,
        salt,
    });
    if (!timingSafeEqual(derived, expected)) {
        return yield* Effect.fail(
            makePasswordError(
                'invalid_credentials',
                '密码不正确。',
            ),
        );
    }

    return { verified: true as const };
});
