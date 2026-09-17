'use client';
import { useEffect, useState } from 'react';

const EMPTY_FORM = { title: '', description: '', contentType: 'pdf', url: '', position: 10, published: true };

export default function AulasManager() {
  const [lessons, setLessons] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  async function loadLessons() {
    const response = await fetch('/api/admin/lessons');
    if (response.ok) {
      const body = await response.json();
      setLessons(body.lessons);
    }
  }

  useEffect(() => {
    loadLessons();
  }, []);

  function startEdit(lesson) {
    setEditingId(lesson.id);
    setForm({
      title: lesson.title,
      description: lesson.description || '',
      contentType: lesson.content_type,
      url: lesson.url,
      position: lesson.position,
      published: lesson.published
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const payload = { ...form, position: Number(form.position) };
    const endpoint = editingId ? `/api/admin/lessons/${editingId}` : '/api/admin/lessons';
    const method = editingId ? 'PATCH' : 'POST';
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      setError('Não foi possível salvar a aula. Confira os campos.');
      return;
    }
    cancelEdit();
    await loadLessons();
  }

  async function handleDelete(id) {
    await fetch(`/api/admin/lessons/${id}`, { method: 'DELETE' });
    await loadLessons();
  }

  return (
    <>
      <h1 className="admin-title">Aulas</h1>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2 className="admin-subtitle">{editingId ? 'Editar aula' : 'Nova aula'}</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="admin-field">
            Título
            <input
              className="admin-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </label>
          <label className="admin-field">
            Descrição
            <textarea
              className="admin-input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="admin-field">
            Tipo
            <select
              className="admin-input"
              value={form.contentType}
              onChange={(e) => setForm({ ...form, contentType: e.target.value })}
            >
              <option value="pdf">PDF</option>
              <option value="video">Vídeo</option>
            </select>
          </label>
          <label className="admin-field">
            URL
            <input
              className="admin-input"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              required
            />
          </label>
          <label className="admin-field">
            Posição
            <input
              className="admin-input"
              type="number"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
              required
            />
          </label>
          <label className="admin-checkbox-field">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm({ ...form, published: e.target.checked })}
            />
            Publicada
          </label>
          {error && <p className="admin-alert admin-alert--error" role="alert">{error}</p>}
          <div className="admin-btn-row">
            <button type="submit" className="admin-btn">{editingId ? 'Salvar' : 'Criar'}</button>
            {editingId && (
              <button type="button" className="admin-btn admin-btn-ghost" onClick={cancelEdit}>Cancelar</button>
            )}
          </div>
        </form>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2 className="admin-subtitle">Lista</h2>
        </div>
        {lessons.length ? (
          <ul className="admin-list">
            {lessons.map((lesson) => (
              <li className="admin-list-item" key={lesson.id}>
                <div className="admin-list-item-info">
                  <span className="admin-list-item-position">{lesson.position}</span>
                  <span>{lesson.title}</span>
                  <span className="admin-list-item-meta">{lesson.content_type}</span>
                  {!lesson.published && <span className="admin-badge admin-badge--draft">rascunho</span>}
                </div>
                <div className="admin-btn-row" style={{ margin: 0 }}>
                  <button type="button" className="admin-btn admin-btn-ghost admin-btn-small" onClick={() => startEdit(lesson)}>Editar</button>
                  <button type="button" className="admin-btn admin-btn-ghost admin-btn-small" onClick={() => handleDelete(lesson.id)}>Excluir</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">Nenhuma aula cadastrada ainda.</p>
        )}
      </section>
    </>
  );
}
