import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { listLessons, getLessonById, createLesson, updateLesson, deleteLesson } = await import('../lib/lessons.js');

describe('lessons store', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('lists only published lessons ordered by position when onlyPublished is true', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: '1', title: 'A', published: true }] });
    const rows = await listLessons({ onlyPublished: true });
    expect(rows).toEqual([{ id: '1', title: 'A', published: true }]);
    expect(queryMock).toHaveBeenCalledWith(
      'select * from lessons where published = true order by position asc',
      []
    );
  });

  it('lists all lessons (including drafts) when onlyPublished is not set', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listLessons();
    expect(queryMock).toHaveBeenCalledWith('select * from lessons order by position asc', []);
  });

  it('creates a lesson with a generated id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-id', title: 'Volume 1' }] });
    const lesson = await createLesson({
      title: 'Volume 1',
      contentType: 'pdf',
      url: 'https://example.com/v1.pdf',
      position: 10,
      published: true
    });
    expect(lesson).toEqual({ id: 'new-id', title: 'Volume 1' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('insert into lessons');
    expect(params).toEqual([expect.any(String), 'Volume 1', null, 'pdf', 'https://example.com/v1.pdf', 10, true]);
  });

  it('updates a lesson by id and returns the updated row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'id-1', title: 'Updated' }] });
    const lesson = await updateLesson('id-1', {
      title: 'Updated',
      contentType: 'video',
      url: 'https://youtube.com/x',
      position: 20,
      published: false
    });
    expect(lesson).toEqual({ id: 'id-1', title: 'Updated' });
  });

  it('returns null when updating a lesson that does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      updateLesson('missing', { title: 'x', contentType: 'pdf', url: 'https://x.com', position: 1, published: true })
    ).resolves.toBeNull();
  });

  it('deletes a lesson and reports true when a row was removed', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await expect(deleteLesson('id-1')).resolves.toBe(true);
  });

  it('reports false when deleting a lesson that does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    await expect(deleteLesson('missing')).resolves.toBe(false);
  });

  it('gets a lesson by id, or null when not found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });
    await expect(getLessonById('id-1')).resolves.toEqual({ id: 'id-1' });
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getLessonById('missing')).resolves.toBeNull();
  });
});
