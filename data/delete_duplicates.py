import sqlite3, os, sys, json

def get_db_path():
    # Assume this script is in the same directory as the DB
    return os.path.abspath('attendance.sqlite')

def list_tables(conn):
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    return [row[0] for row in cur.fetchall()]

def get_columns(conn, table):
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table});")
    # Returns: cid, name, type, notnull, dflt_value, pk
    return [row[1] for row in cur.fetchall()]

def delete_duplicates(conn, table, columns):
    cur = conn.cursor()
    cols_join = ', '.join([f'`{col}`' for col in columns])
    # Find duplicate rows based on all columns (excluding rowid)
    duplicate_query = f"""
        SELECT {cols_join}, MIN(rowid) as keep_id, GROUP_CONCAT(rowid) as all_ids, COUNT(*) as cnt
        FROM {table}
        GROUP BY {cols_join}
        HAVING cnt > 1;
    """
    cur.execute(duplicate_query)
    rows = cur.fetchall()
    total_deleted = 0
    for row in rows:
        # row structure: col1, col2, ..., keep_id, all_ids, cnt
        keep_id = row[-3]
        all_ids = row[-2]
        ids = [int(i) for i in all_ids.split(',')]
        ids_to_delete = [i for i in ids if i != keep_id]
        if ids_to_delete:
            placeholders = ','.join('?' for _ in ids_to_delete)
            delete_sql = f"DELETE FROM {table} WHERE rowid IN ({placeholders});"
            cur.execute(delete_sql, ids_to_delete)
            total_deleted += len(ids_to_delete)
    conn.commit()
    return total_deleted

def main():
    db_path = get_db_path()
    if not os.path.exists(db_path):
        print(json.dumps({"error": f"Database not found at {db_path}"}))
        sys.exit(1)
    conn = sqlite3.connect(db_path)
    tables = list_tables(conn)
    result = {}
    for tbl in tables:
        cols = get_columns(conn, tbl)
        if not cols:
            continue
        deleted = delete_duplicates(conn, tbl, cols)
        result[tbl] = {"deleted_rows": deleted}
    conn.close()
    print(json.dumps({"tables": result}, indent=2))

if __name__ == '__main__':
    main()
