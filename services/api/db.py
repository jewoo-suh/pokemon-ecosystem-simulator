from contextlib import contextmanager
from psycopg2.pool import SimpleConnectionPool
from psycopg2.extras import RealDictCursor
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

pool = None


def init_pool():
    global pool
    pool = SimpleConnectionPool(
        1, 5,
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )


def close_pool():
    if pool:
        pool.closeall()


@contextmanager
def get_cursor():
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
    finally:
        pool.putconn(conn)
