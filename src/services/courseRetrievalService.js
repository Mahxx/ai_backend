const { config } = require("./configService");
const { httpError } = require("./httpError");
const { readTextObject } = require("./courseStorageService");
const { getSupabaseClient } = require("./supabaseService");

async function listModules() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("modules")
    .select("id,name,description,level,sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw httpError(500, "Lecture des modules IA impossible.", error.message);
  }
  return data || [];
}

async function listCourses(moduleId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id,module_id,title,summary,keywords,total_chunks,ready,sort_order")
    .eq("module_id", moduleId)
    .eq("active", true)
    .eq("ready", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) {
    throw httpError(500, "Lecture des cours IA impossible.", error.message);
  }
  return data || [];
}

async function buildCourseContext({ moduleId, courseIds = [], subjectText }) {
  const chunks = await selectChunks({ moduleId, courseIds, subjectText });
  if (chunks.length === 0) {
    throw httpError(
      422,
      "Aucun cours optimise disponible pour ce module."
    );
  }

  const texts = [];
  let totalChars = 0;
  for (const chunk of chunks) {
    if (totalChars >= config.maxCourseContextChars) break;
    const text = await readTextObject(chunk.storage_path);
    const block = formatChunk(chunk, text);
    texts.push(block);
    totalChars += block.length;
  }

  return {
    context: texts.join("\n\n").slice(0, config.maxCourseContextChars),
    selectedChunks: chunks.map((chunk) => ({
      courseId: chunk.course_id,
      chunkIndex: chunk.chunk_index,
      storagePath: chunk.storage_path,
      tokenEstimate: chunk.token_estimate,
    })),
  };
}

async function selectChunks({ moduleId, courseIds, subjectText }) {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("course_chunks")
    .select("id,module_id,course_id,chunk_index,storage_path,summary,keywords,token_estimate")
    .eq("module_id", moduleId)
    .order("course_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (courseIds.length > 0) {
    query = query.in("course_id", courseIds);
  }

  const { data, error } = await query;
  if (error) {
    throw httpError(500, "Selection des chunks impossible.", error.message);
  }

  const chunks = data || [];
  if (courseIds.length > 0) {
    return capChunksByEstimate(chunks);
  }

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, subjectText),
    }))
    .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index)
    .map((item) => item.chunk);

  return capChunksByEstimate(scored);
}

function capChunksByEstimate(chunks) {
  const maxTokens = Math.ceil(config.maxCourseContextChars / 4);
  const selected = [];
  let total = 0;
  for (const chunk of chunks) {
    const estimate = Number(chunk.token_estimate || 800);
    if (selected.length > 0 && total + estimate > maxTokens) break;
    selected.push(chunk);
    total += estimate;
  }
  return selected.slice(0, 30);
}

function scoreChunk(chunk, subjectText) {
  const subjectWords = new Set(tokenize(subjectText));
  const keywords = Array.isArray(chunk.keywords) ? chunk.keywords : [];
  let score = 0;

  for (const keyword of keywords) {
    const normalized = keyword.toString().toLowerCase();
    if (subjectWords.has(normalized)) score += 6;
    if (subjectText.toLowerCase().includes(normalized)) score += 3;
  }

  for (const word of tokenize(chunk.summary || "")) {
    if (subjectWords.has(word)) score += 1;
  }

  return score;
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u017f]+/i)
    .filter((word) => word.length >= 4);
}

function formatChunk(chunk, text) {
  return [
    `Cours ${chunk.course_id} - chunk ${chunk.chunk_index}`,
    chunk.summary ? `Resume: ${chunk.summary}` : "",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = { buildCourseContext, listCourses, listModules };
