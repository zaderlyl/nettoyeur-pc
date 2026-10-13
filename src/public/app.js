const $ = (id) => document.getElementById(id);

const etatUI = {
  vue: 'fichiers', // fichiers | projets
  chemin: [], // segments du dossier courant
  lignes: [],
  selection: null,
};

// Crée un élément en toute sécurité (les noms de fichiers ne passent jamais par innerHTML)
function el(tag, props = {}, ...enfants) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...enfants.filter((c) => c != null));
  return e;
}

const formatTaille = (o) => {
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (o >= 1024 && i < u.length - 1) { o /= 1024; i++; }
  return `${o.toFixed(i && o < 100 ? 1 : 0)} ${u[i]}`;
};
const formatDate = (ms) => (ms ? new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const extension = (nom) => (nom.includes('.') && !nom.startsWith('.') ? nom.slice(nom.lastIndexOf('.')).toLowerCase() : '');

function libelleType(l) {
  if (l.projet) return `Projet ${l.projet.technos.join(', ') || 'git'}`;
  if (l.type === 'dossier') return 'Dossier';
  if (l.type === 'lien') return 'Lien';
  return extension(l.nom) ? `Fichier ${extension(l.nom)}` : 'Fichier';
}

// ---------- Scan ----------
async function suivreScan() {
  const e = await (await fetch('/api/scan')).json();
  $('resume').textContent = e.etat === 'inactif' ? 'Aucun scan lancé.'
    : `${e.fichiers.toLocaleString('fr')} fichiers, ${e.dossiers.toLocaleString('fr')} dossiers, ${e.projets} projets, ${formatTaille(e.taille)}` +
      (e.erreurs ? ` (${e.erreurs} inaccessibles)` : '');
  $('courant').textContent = e.courant;
  if (e.etat === 'en-cours') {
    $('scan').disabled = true;
    return setTimeout(suivreScan, 500);
  }
  $('scan').disabled = false;
  if (e.etat === 'termine') {
    $('resume').textContent += ` — scanné en ${((e.fin - e.debut) / 1000).toFixed(1)} s`;
    $('app').hidden = false;
    etatUI.chemin = [];
    charger();
  }
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true;
  await fetch('/api/scan', { method: 'POST' });
  suivreScan();
});

// ---------- Chargement des lignes ----------
async function charger() {
  etatUI.selection = null;
  afficherDetails(null);
  $('option-imbriques').hidden = etatUI.vue !== 'projets';

  if (etatUI.vue === 'fichiers') {
    const rel = etatUI.chemin.join('/');
    const d = await (await fetch(`/api/dossier?chemin=${encodeURIComponent(rel)}`)).json();
    etatUI.lignes = (d.enfants ?? []).map((e) => ({ ...e, chemin: [...etatUI.chemin, e.nom].join('/') }));
  } else {
    const projets = await (await fetch('/api/projets')).json();
    etatUI.lignes = projets
      .filter((p) => $('imbriques').checked || !p.parent)
      .map((p) => ({
        nom: p.nom || p.chemin.split('/').pop(), chemin: p.chemin, type: 'dossier', taille: p.taille,
        modifie: p.activite, contenu: 1, projet: p, vueProjet: true,
      }));
  }
  afficherFil();
  afficherListe();
}

// ---------- Fil d'Ariane ----------
function afficherFil() {
  const fil = $('fil');
  fil.replaceChildren();
  if (etatUI.vue === 'projets') {
    fil.append(el('span', { textContent: `${etatUI.lignes.length} projets` }));
    return;
  }
  const aller = (n) => { etatUI.chemin = etatUI.chemin.slice(0, n); charger(); };
  fil.append(el('a', { textContent: '~ (dossier personnel)', onclick: () => aller(0) }));
  etatUI.chemin.forEach((seg, i) => {
    fil.append(el('span', { textContent: ' / ' }), el('a', { textContent: seg, onclick: () => aller(i + 1) }));
  });
}

// ---------- Liste triée ----------
function trier(lignes) {
  const cle = $('tri').value;
  const copie = [...lignes];
  if (cle === 'nom') return copie.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (cle === 'type') return copie.sort((a, b) => libelleType(a).localeCompare(libelleType(b), 'fr') || b.taille - a.taille);
  return copie.sort((a, b) => (b[cle] ?? 0) - (a[cle] ?? 0));
}

function afficherListe() {
  const lignes = trier(etatUI.lignes);
  const max = Math.max(1, ...lignes.map((l) => l.taille));
  const corps = $('liste');
  corps.replaceChildren();
  $('vide').hidden = lignes.length > 0;

  for (const l of lignes) {
    const nom = el('div', { className: 'nom' }, `${l.type === 'dossier' ? '📁' : l.type === 'lien' ? '🔗' : '📄'} ${l.nom}`);
    if (l.projet) nom.append(el('span', { className: 'etiquette', textContent: 'projet' }));
    const tr = el('tr', {},
      el('td', {}, nom),
      el('td', { textContent: libelleType(l) }),
      el('td', { className: 'num taille' }, el('i', { style: `width:${(l.taille / max) * 100}%` }), el('b', { textContent: formatTaille(l.taille) })),
      el('td', { className: 'num', textContent: formatDate(l.modifie) }),
    );
    tr.addEventListener('click', () => {
      corps.querySelector('.selection')?.classList.remove('selection');
      tr.classList.add('selection');
      etatUI.selection = l;
      afficherDetails(l);
    });
    tr.addEventListener('dblclick', () => ouvrir(l));
    corps.append(tr);
  }
}

// Ouvre un dossier navigable (les dossiers « opaques » comme node_modules ne le sont pas)
function ouvrir(l) {
  if (l.type !== 'dossier' || l.contenu === null) return;
  etatUI.vue = 'fichiers';
  document.querySelectorAll('#onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.vue === 'fichiers'));
  etatUI.chemin = l.chemin.split('/').filter(Boolean);
  charger();
}

// ---------- Panneau de détails ----------
function afficherDetails(l) {
  const panneau = $('details');
  panneau.replaceChildren();
  if (!l) {
    panneau.append(el('p', { className: 'discret', textContent: 'Clique sur une ligne pour voir ses informations.' }));
    return;
  }
  const dl = el('dl');
  const ligne = (k, v) => { if (v != null && v !== '') dl.append(el('dt', { textContent: k }), el('dd', { textContent: v })); };

  ligne('Type', libelleType(l));
  ligne('Chemin', `~/${l.chemin}`);
  ligne('Taille', `${formatTaille(l.taille)} (${l.taille.toLocaleString('fr')} octets)`);
  if (!l.vueProjet) ligne('Modifié', formatDate(l.modifie)); // pour un projet, l'activité est dans son bloc
  ligne('Créé', l.cree ? formatDate(l.cree) : null);
  ligne('Dernier accès', l.acces ? formatDate(l.acces) : null);
  if (l.type === 'dossier' && !l.vueProjet) {
    ligne('Contenu', l.contenu === null ? 'non listé (dépendances / dépôt git)' : `${l.contenu} élément(s)`);
  }

  if (l.projet) {
    const p = l.projet;
    dl.append(el('div', { className: 'sep' }));
    ligne('Projet', p.nom);
    ligne('Description', p.description);
    ligne('Technologies', p.technos.join(', '));
    ligne('Git', p.git ? 'oui' : 'non');
    ligne('Branche', p.branche);
    ligne('Dépôt distant', p.distant);
    ligne('Dernière activité', formatDate(p.activite));
    ligne('Récupérable', p.regenerable ? `${formatTaille(p.regenerable)} (dépendances, builds)` : null);
  }

  panneau.append(el('h2', { textContent: l.nom }), dl);
  if (l.type === 'dossier' && l.contenu !== null) {
    panneau.append(el('p', {}, el('button', { className: 'primaire', textContent: 'Ouvrir le dossier', onclick: () => ouvrir(l) })));
  }
}

// ---------- Événements ----------
$('tri').addEventListener('change', afficherListe);
$('imbriques').addEventListener('change', charger);
document.querySelectorAll('#onglets button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#onglets button').forEach((x) => x.classList.toggle('actif', x === b));
  etatUI.vue = b.dataset.vue;
  charger();
}));

suivreScan(); // si un scan existe déjà côté serveur, on l'affiche directement
