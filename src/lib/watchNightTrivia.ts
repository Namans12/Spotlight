/** Reviewed editorial packs. Never infer story facts from catalogue metadata. */
export interface TriviaQuestion { prompt: string; choices: string[]; answer: string; explanation: string; source: string; sourceUrl: string }
export interface TriviaPack { key: string; title: string; checkedAt: string; questions: TriviaQuestion[] }
const question = (prompt: string, choices: string[], answer: string, explanation: string, source: string, sourceUrl: string): TriviaQuestion => ({ prompt, choices, answer, explanation, source, sourceUrl });
const pixar = 'https://www.pixar.com/ratatouille';
const yrf = 'https://www.yashrajfilms.com/movies/kuch-kuch-hota-hai';
const d23 = 'https://d23.com/a-to-z/doctor-strange-film/';
export const TRIVIA_PACKS: readonly TriviaPack[] = [
 { key: 'movie:284052', title: 'Doctor Strange (2016)', checkedAt: '2026-11-14', questions: [
  question('What is the Wi-Fi password at Kamar-Taj?', ['Agamotto', 'Shamballa', 'Dormammu'], 'Shamballa', 'Mordo gives Strange a card with the password, rather than a mantra.', 'Marvel Entertainment · official trailer', 'https://www.youtube.com/watch?v=HSzx-zryEgM'),
  question('What kind of surgeon was Stephen Strange?', ['Heart surgeon', 'Orthopaedic surgeon', 'Neurosurgeon'], 'Neurosurgeon', 'His injured hands end his neurosurgery career and start his search for healing.', 'Disney D23', d23),
  question('Who teaches Strange about the mystical arts?', ['The Ancient One', 'Odin', 'The Collector'], 'The Ancient One', 'Strange encounters the Ancient One on his journey.', 'Disney D23', d23),
 ] },
 { key: 'movie:2062', title: 'Ratatouille', checkedAt: '2026-11-14', questions: [
  question('What is the title of Gusteau’s cookbook?', ['The Paris Kitchen', 'Anyone Can Cook', 'The Perfect Plate'], 'Anyone Can Cook', 'Gusteau’s belief in accessible cooking inspires Remy.', 'Pixar', pixar),
  question('Which food critic threatens the restaurant’s reputation?', ['Anton Ego', 'Skinner', 'Emile'], 'Anton Ego', 'Ego is the critic whose review matters to Gusteau’s restaurant.', 'Pixar', pixar),
  question('What is the name of Remy’s brother?', ['Linguini', 'Django', 'Emile'], 'Emile', 'Emile shares Remy’s love of food, but not his discerning palate.', 'Pixar', pixar),
 ] },
 { key: 'movie:11854', title: 'Kuch Kuch Hota Hai', checkedAt: '2026-11-14', questions: [
  question('Who is Rahul’s first wife?', ['Anjali', 'Tina', 'Pooja'], 'Tina', 'Rahul and Tina are the parents of young Anjali.', 'Yash Raj Films', yrf),
  question('How does young Anjali learn her mother’s story?', ['A diary', 'Recorded tapes', 'Letters'], 'Letters', 'Tina leaves letters for her daughter.', 'Yash Raj Films', yrf),
  question('Where did Rahul and Anjali study?', ['St. Xavier’s College', 'St. Teresa’s College', 'Imperial College'], 'St. Xavier’s College', 'YRF’s synopsis places their college friendship at St. Xavier’s.', 'Yash Raj Films', yrf),
 ] },
];
export function triviaPack(mediaType: 'movie' | 'tv', id: number): TriviaPack | undefined {
 return TRIVIA_PACKS.find(pack => pack.key === `${mediaType}:${id}`);
}
