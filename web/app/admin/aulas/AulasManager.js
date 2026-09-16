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
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 720 }}>
      <h1>Aulas</h1>

      <form onSubmit={handleSubmit}>
        <h2>{editingId ? 'Editar aula' : 'Nova aula'}</h2>
        <label>
          Título
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </label>
        <label>
          Descrição
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label>
          Tipo
          <select value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value })}>
            <option value="pdf">PDF</option>
            <option value="video">Vídeo</option>
          </select>
        </label>
        <label>
          URL
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
        </label>
        <label>
          Posição
          <input
            type="number"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
            required
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => setForm({ ...form, published: e.target.checked })}
          />
          Publicada
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">{editingId ? 'Salvar' : 'Criar'}</button>
        {editingId && <button type="button" onClick={cancelEdit}>Cancelar</button>}
      </form>

      <h2>Lista</h2>
      <ul>
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <strong>{lesson.position}</strong> — {lesson.title} ({lesson.content_type}
            {lesson.published ? '' : ', rascunho'})
            <button type="button" onClick={() => startEdit(lesson)}>Editar</button>
            <button type="button" onClick={() => handleDelete(lesson.id)}>Excluir</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
