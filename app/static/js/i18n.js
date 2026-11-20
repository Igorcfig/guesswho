// Internacionalização do cliente: pt-BR (padrão) e inglês.
// - `t(key, vars)` procura em DICT (textos do JS) e depois nos textos das páginas embutidos pelo servidor
//   (<script id="i18n-pages">, vindos de app/i18n.py), com interpolação de `{nome}`.
// - O idioma fica no cookie `lang` (lido pelo servidor) e no localStorage. Sem escolha salva, é sempre pt.
// - `setLang()` re-traduz a página sem recarregar ([data-i18n], [data-i18n-html], [data-i18n-attr]) e avisa
//   quem se inscreveu com `onLangChange()` (cada página re-renderiza o que é dinâmico).

const LANGS = ['pt', 'en'];
const STORE_KEY = 'cac_lang';
const HTML_LANG = { pt: 'pt-BR', en: 'en' };
const LOCALE = { pt: 'pt-BR', en: 'en-US' };

const DICT = {
  pt: {
    // common.js
    'net.offline': 'Sem conexão com o servidor. Tente de novo.',
    'net.status': 'Erro {status} no servidor.',
    'color.n': 'Cor {n}',
    // home.js
    'home.need_name': 'Escolha um apelido antes de jogar.',
    'home.room_of': 'Sala de {name}',
    'home.bad_code': 'O código tem 4 letras ou números, como K7Q2.',
    'home.rooms_one': '1 sala · atualiza sozinho',
    'home.rooms_n': '{n} salas · atualiza sozinho',
    'home.none': 'Nenhuma sala aberta agora.',
    'home.none_hint': 'Crie uma sala ou clique em "Jogar agora" para abrir a primeira.',
    'home.playing': 'em partida',
    'home.waiting': 'esperando',
    'home.mode_team': 'Time x Time',
    'home.mode_duel': 'Duelo',
    'home.enter_room': 'Entrar na sala {name}',
    'home.enter': 'Entrar',
    'home.meta': 'Tema: {theme} · {mode} · {status}',
    'home.people': '{n} de {max} pessoas',
    'home.full': 'Lotada',
    'home.offline': 'sem conexão',
    'home.load_fail': 'Não deu para carregar as salas.',
    'home.retrying': 'Tentando de novo em instantes…',
    'home.room_gone': 'Essa sala não existe ou já foi fechada.',
    'theme.classic': 'Clássico',
    // theme_editor.js
    'th.bad_type': '"{file}" não é PNG, JPG ou WEBP.',
    'th.too_big': '"{file}" tem mais de 2 MB.',
    'th.over_limit': 'O tema aceita no máximo {max} personagens; {n} foto(s) ficaram de fora.',
    'th.char_name': 'Nome do personagem {n}',
    'th.remove_char': 'Remover personagem',
    'th.name': 'Nome',
    'th.char_n': 'personagem {n}',
    'th.remove': 'Remover {name}',
    'th.min_left': 'mínimo de {min} personagens · faltam {n}',
    'th.complete': 'tema completo!',
    'th.up_to': 'pode ter até {max}',
    'th.err_name': 'Dê um nome ao tema (até 40 caracteres).',
    'th.err_author': 'Diga quem é o autor (até 20 caracteres).',
    'th.err_min': 'Adicione pelo menos {min} personagens (faltam {n}).',
    'th.err_max': 'No máximo {max} personagens.',
    'th.err_empty_one': 'Um personagem está sem nome.',
    'th.err_empty_n': '{n} personagens estão sem nome.',
    'th.err_dups': 'Nomes repetidos: {names}. Cada personagem precisa de um nome diferente.',
    'th.saving': 'Salvando…',
    'th.done_public': '"{name}" já aparece na lista de temas das salas. Escolha-o nas configurações do lobby.',
    'th.done_private': '"{name}" é privado: só aparece para você neste navegador e para quem entrar numa sala que o use.',
    'th.saved': 'Tema salvo!',
    // room.js — conexão
    'r.invalid_action': 'Ação inválida.',
    'r.other_tab': 'Você abriu esta sala em outra aba ou aparelho. Esta aba foi desconectada.',
    'r.use_tab': 'Usar esta aba',
    'r.full': 'A sala está cheia (máximo de 12 pessoas).',
    'r.try_again': 'Tentar de novo',
    'r.lost': 'Conexão perdida. Reconectando em {s} s…',
    'r.connecting_room': 'Tentando conectar à sala…',
    'r.connecting': 'Conectando…',
    'r.no_conn': 'Sem conexão com a sala. Aguarde a reconexão.',
    'r.someone': 'Alguém',
    'r.p1': 'Jogador 1',
    'r.p2': 'Jogador 2',
    'r.yellow': 'Amarelo',
    'r.coral': 'Coral',
    'r.team_a': 'Time Amarelo',
    'r.team_b': 'Time Coral',
    // lobby
    'r.hint_team': 'Cada time tem um segredo e um tabuleiro. Os membros se revezam para perguntar.',
    'r.hint_duel': 'Dois jogadores se enfrentam; o vencedor fica na mesa e o próximo da fila entra.',
    'r.only_host_mode': ' Só o anfitrião muda o modo.',
    'r.you_tag': ' (você)',
    'r.offline': 'OFFLINE',
    'r.you_host': 'Você é o anfitrião',
    'r.host_is': 'Anfitrião: {name}',
    'r.one_player': '1 jogador',
    'r.n_players': '{n} jogadores',
    'r.host_tag': 'ANFITRIÃO',
    'r.seat_free': 'Lugar vago',
    'r.nobody_yet': 'Ninguém ainda',
    'r.you_here': 'Você está aqui',
    'r.you_in_team': 'Você está neste time',
    'r.seat_taken': 'Lugar ocupado',
    'r.play_as': 'Jogar como {who}',
    'r.join_team_a': 'Entrar no Time Amarelo',
    'r.join_team_b': 'Entrar no Time Coral',
    'r.queue_pos': '{n}º na fila',
    'r.nobody_watching': 'Ninguém assistindo',
    'r.become_spec': 'Virar observador',
    'r.watching': 'Você está assistindo',
    'r.spec_hint_duel': 'Quem assiste entra na fila e joga contra o vencedor. O chat dos observadores não chega aos jogadores.',
    'r.spec_hint_team': 'Quem não escolhe lado assiste aos dois tabuleiros. O chat dos observadores não chega aos jogadores.',
    'r.ready': 'Tudo pronto. Bora!',
    'r.need_players': 'Precisa de pelo menos 1 jogador em cada lado.',
    'r.waiting_start': 'Aguardando {host} começar a partida.',
    'r.the_host': 'o anfitrião',
    'r.copied': 'Link copiado! Mande para a galera.',
    'r.copy_this': 'Copie o link: {url}',
    'r.theme_opt_classic': '{name} ({n} personagens)',
    'r.theme_opt': '{name} · por {author} ({n})',
    'r.my_themes': 'Seus temas',
    'r.chosen_theme': 'Tema escolhido',
    // partida
    'r.preparing': 'Preparando a partida…',
    'r.game_over_w': 'Fim da partida: {phrase}',
    'r.match_ended': 'Partida encerrada',
    'r.turn_nobody_mine': 'Vez do seu lado: ninguém conectado para perguntar.',
    'r.turn_nobody': 'Vez de {side}: ninguém conectado para perguntar.',
    'r.your_turn': 'Sua vez de perguntar (ou chutar)!',
    'r.team_asking': 'Vez do seu time: {name} está perguntando.',
    'r.duel_asking': 'Vez de {name} perguntar.',
    'r.other_asking': 'Vez do {side}: {name} está perguntando.',
    'r.answer_q': 'Responda: {q}',
    'r.waiting_answer': 'Aguardando {name} responder.',
    'r.other_side': 'o outro lado',
    'r.answering': '{name} está respondendo: {q}',
    'r.your_team': 'Seu time',
    'r.w_you': 'você venceu!',
    'r.w_your_team': 'seu time venceu!',
    'r.w_duel': '{side} venceu.',
    'r.w_team': 'o {side} venceu.',
    'r.room_sub': 'Sala {code} · {mode} · Tema {theme}',
    'r.match_n': 'Partida {n}',
    'r.match_n_of': 'Partida {n} de {of}',
    'r.your_secret': 'Seu segredo',
    'r.team_secret': 'Segredo do seu time',
    'r.you': 'Você',
    'r.your_team_side': 'Seu time · {side}',
    'r.opponent': 'Adversário',
    'r.left_n': 'restam {n}',
    'r.tag_asks': 'PERGUNTA',
    'r.tag_answers': 'RESPONDE',
    'r.one_watcher': '1 observador assistindo',
    'r.n_watchers': '{n} observadores assistindo',
    'r.asked': '{name} perguntou:',
    'r.ask_ph': 'Seu personagem usa chapéu?',
    'r.wait_turn_ph': 'Aguarde a sua vez de perguntar',
    'r.your_q': 'Sua pergunta',
    'r.your_q_wait': 'Sua pergunta (não é sua vez)',
    'r.cancel_guess': 'Cancelar chute',
    'r.guess_char': 'Chutar personagem',
    'r.guess_name': 'Chutar {name}',
    'r.flipped': ', virado',
    'r.pick_guess': 'Escolha o personagem do chute',
    'r.flip_hint': 'Clique para virar quem você já descartou · restam {n}',
    'r.q_too_long': 'A pergunta pode ter no máximo 140 caracteres.',
    'r.click_guess': 'Clique no personagem que você quer chutar.',
    'r.guess_title': 'Chutar {name}?',
    // log
    'log.v_guess': 'chutou',
    'log.v_timeout': 'deixou o tempo acabar',
    'log.v_question': 'perguntou',
    'log.you': 'Você {verb}',
    'log.name': '{name} {verb}',
    'log.name_team': '{name} (seu time) {verb}',
    'log.name_side': '{name} ({side}) {verb}',
    'log.name_side_q': '{name} ({side}) {verb} ao seu time',
    'log.waiting': '{who} · aguardando',
    'log.yes': 'SIM',
    'log.no': 'NÃO',
    'log.time': 'TEMPO',
    'log.hit': 'ACERTOU',
    'log.miss': 'ERROU',
    'log.is_it': 'É {name}?',
    'log.guess': 'Chute',
    'log.no_ask': 'Não perguntou a tempo.',
    'log.empty': 'Nenhuma pergunta ainda. As perguntas e respostas aparecem aqui.',
    // observador
    'r.observing': 'Sala {code} · Você está observando',
    'r.queue_next': 'Você é o próximo da fila',
    'r.queue_nth': 'Você é o {n}º da fila',
    'r.waiting_match': 'Aguardando a partida…',
    'r.s_over_w': 'Fim da partida {n}: {side} venceu.',
    'r.s_ended': 'Partida encerrada.',
    'r.s_turn_duel': 'Vez de {side}: {name} pergunta.',
    'r.s_turn_team': 'Vez do {side}: {name} pergunta.',
    'r.s_answering': '{asker} perguntou "{q}" · {answerer} responde.',
    'r.offline_paren': ' (offline)',
    'r.nobody': 'Ninguém',
    'r.s_asking_now': 'Perguntando agora',
    'r.s_wait_answer': 'Esperando a resposta',
    'r.s_answering_now': 'Respondendo',
    'r.s_waiting': 'Aguardando',
    'r.s_won': 'Venceu a partida',
    'r.s_lost': 'Perdeu a partida',
    'r.secret_of': 'Segredo: {name}',
    'r.secret': 'Segredo',
    'r.is_target': ', é o alvo',
    // timer
    'r.no_timer': 'Sem cronômetro',
    'r.time_left': 'Tempo restante {n} segundos',
    // fim
    'r.series_over': 'Fim da série',
    'r.match_over_n': 'Fim da partida {n}',
    'r.t_champ_you': 'Você é campeão!',
    'r.t_champ_team': 'Vocês são campeões!',
    'r.t_champ': '{side} é campeão!',
    'r.t_won_you': 'Você venceu!',
    'r.t_won_team': 'Seu time venceu!',
    'r.t_lost_you': 'Você perdeu!',
    'r.t_lost_team': 'Seu time perdeu!',
    'r.t_won': '{side} venceu!',
    'r.reason_hit': '{who} acertou: era {name}!',
    'r.right_char': 'o personagem certo',
    'r.reason_miss': '{who} chutou {name} e errou.',
    'r.reason_wrong': '{who} chutou errado.',
    'r.reason_wo': 'Vitória por W.O.: o outro lado ficou sem jogadores conectados.',
    'r.secret_duel': 'Segredo de {side}',
    'r.secret_team': 'Segredo do {side}',
    'r.wait_next': 'Aguardando {host} começar a próxima partida…',
    'r.wait_lobby': 'Aguardando {host} voltar ao lobby…',
    // chat
    'chat.room_title': 'Chat da sala',
    'chat.room_label': 'Mensagem para a sala',
    'chat.room_ph': 'Diga oi para a sala',
    'chat.team_title': 'Chat do time',
    'chat.team_label': 'Mensagem (só seu time vê)',
    'chat.team_ph': 'Combine a próxima pergunta…',
    'chat.spec_title': 'Chat dos observadores',
    'chat.spec_label': 'Mensagem (só observadores veem)',
    'chat.spec_ph': 'Comente a partida…',
    'chat.tab': 'Chat',
    'chat.unread': '{n} mensagens novas',
    'chat.ch_team': 'time',
    'chat.ch_spec': 'observadores',
    // apelido
    'r.name_error': 'Digite um apelido de 1 a 20 caracteres.',
    'r.pick_name': 'Escolha um apelido para entrar.',
    'r.title': 'Cara a Cara · {name}',
  },
  en: {
    'net.offline': "Can't reach the server. Try again.",
    'net.status': 'Server error {status}.',
    'color.n': 'Color {n}',
    'home.need_name': 'Pick a nickname before playing.',
    'home.room_of': "{name}'s room",
    'home.bad_code': 'Codes are 4 letters or numbers, like K7Q2.',
    'home.rooms_one': '1 room · updates on its own',
    'home.rooms_n': '{n} rooms · updates on its own',
    'home.none': 'No open rooms right now.',
    'home.none_hint': 'Create a room or hit "Play now" to open the first one.',
    'home.playing': 'in a match',
    'home.waiting': 'waiting',
    'home.mode_team': 'Team vs Team',
    'home.mode_duel': 'Duel',
    'home.enter_room': 'Join room {name}',
    'home.enter': 'Join',
    'home.meta': 'Theme: {theme} · {mode} · {status}',
    'home.people': '{n} of {max} people',
    'home.full': 'Full',
    'home.offline': 'offline',
    'home.load_fail': "Couldn't load the rooms.",
    'home.retrying': 'Trying again in a moment…',
    'home.room_gone': "That room doesn't exist or has already closed.",
    'theme.classic': 'Classic',
    'th.bad_type': '"{file}" isn\'t a PNG, JPG or WEBP.',
    'th.too_big': '"{file}" is over 2 MB.',
    'th.over_limit': 'A theme takes up to {max} characters; {n} photo(s) were left out.',
    'th.char_name': 'Character {n} name',
    'th.remove_char': 'Remove character',
    'th.name': 'Name',
    'th.char_n': 'character {n}',
    'th.remove': 'Remove {name}',
    'th.min_left': 'at least {min} characters · {n} to go',
    'th.complete': 'theme complete!',
    'th.up_to': 'up to {max}',
    'th.err_name': 'Give the theme a name (up to 40 characters).',
    'th.err_author': "Tell us who's the author (up to 20 characters).",
    'th.err_min': 'Add at least {min} characters ({n} to go).',
    'th.err_max': '{max} characters max.',
    'th.err_empty_one': 'One character has no name.',
    'th.err_empty_n': '{n} characters have no name.',
    'th.err_dups': 'Repeated names: {names}. Each character needs a different name.',
    'th.saving': 'Saving…',
    'th.done_public': '"{name}" is now in the rooms\' theme list. Pick it in the lobby settings.',
    'th.done_private': '"{name}" is private: it only shows up for you in this browser and for anyone joining a room that uses it.',
    'th.saved': 'Theme saved!',
    'r.invalid_action': 'Invalid action.',
    'r.other_tab': 'You opened this room in another tab or device. This tab was disconnected.',
    'r.use_tab': 'Use this tab',
    'r.full': 'The room is full (12 people max).',
    'r.try_again': 'Try again',
    'r.lost': 'Connection lost. Reconnecting in {s} s…',
    'r.connecting_room': 'Trying to connect to the room…',
    'r.connecting': 'Connecting…',
    'r.no_conn': 'No connection to the room. Hang on while we reconnect.',
    'r.someone': 'Someone',
    'r.p1': 'Player 1',
    'r.p2': 'Player 2',
    'r.yellow': 'Yellow',
    'r.coral': 'Coral',
    'r.team_a': 'Yellow Team',
    'r.team_b': 'Coral Team',
    'r.hint_team': 'Each team has a secret and a board. Members take turns asking.',
    'r.hint_duel': 'Two players face off; the winner stays and the next in line steps in.',
    'r.only_host_mode': ' Only the host can change the mode.',
    'r.you_tag': ' (you)',
    'r.offline': 'OFFLINE',
    'r.you_host': "You're the host",
    'r.host_is': 'Host: {name}',
    'r.one_player': '1 player',
    'r.n_players': '{n} players',
    'r.host_tag': 'HOST',
    'r.seat_free': 'Open seat',
    'r.nobody_yet': 'Nobody yet',
    'r.you_here': "You're here",
    'r.you_in_team': "You're on this team",
    'r.seat_taken': 'Seat taken',
    'r.play_as': 'Play as {who}',
    'r.join_team_a': 'Join Yellow Team',
    'r.join_team_b': 'Join Coral Team',
    'r.queue_pos': '#{n} in line',
    'r.nobody_watching': 'Nobody watching',
    'r.become_spec': 'Just watch',
    'r.watching': "You're watching",
    'r.spec_hint_duel': 'Spectators join the line and play the winner. Spectator chat never reaches the players.',
    'r.spec_hint_team': 'Anyone without a side watches both boards. Spectator chat never reaches the players.',
    'r.ready': "All set. Let's go!",
    'r.need_players': 'Needs at least 1 player on each side.',
    'r.waiting_start': 'Waiting for {host} to start the match.',
    'r.the_host': 'the host',
    'r.copied': 'Link copied! Send it to the gang.',
    'r.copy_this': 'Copy the link: {url}',
    'r.theme_opt_classic': '{name} ({n} characters)',
    'r.theme_opt': '{name} · by {author} ({n})',
    'r.my_themes': 'Your themes',
    'r.chosen_theme': 'Chosen theme',
    'r.preparing': 'Getting the match ready…',
    'r.game_over_w': 'Match over: {phrase}',
    'r.match_ended': 'Match over',
    'r.turn_nobody_mine': "Your side's turn: nobody connected to ask.",
    'r.turn_nobody': "{side}'s turn: nobody connected to ask.",
    'r.your_turn': 'Your turn to ask (or guess)!',
    'r.team_asking': "Your team's turn: {name} is asking.",
    'r.duel_asking': "{name}'s turn to ask.",
    'r.other_asking': "{side}'s turn: {name} is asking.",
    'r.answer_q': 'Answer: {q}',
    'r.waiting_answer': 'Waiting for {name} to answer.',
    'r.other_side': 'the other side',
    'r.answering': '{name} is answering: {q}',
    'r.your_team': 'Your team',
    'r.w_you': 'you won!',
    'r.w_your_team': 'your team won!',
    'r.w_duel': '{side} won.',
    'r.w_team': '{side} won.',
    'r.room_sub': 'Room {code} · {mode} · {theme} theme',
    'r.match_n': 'Match {n}',
    'r.match_n_of': 'Match {n} of {of}',
    'r.your_secret': 'Your secret',
    'r.team_secret': "Your team's secret",
    'r.you': 'You',
    'r.your_team_side': 'Your team · {side}',
    'r.opponent': 'Opponent',
    'r.left_n': '{n} left',
    'r.tag_asks': 'ASKING',
    'r.tag_answers': 'ANSWERING',
    'r.one_watcher': '1 spectator watching',
    'r.n_watchers': '{n} spectators watching',
    'r.asked': '{name} asked:',
    'r.ask_ph': 'Does your character wear a hat?',
    'r.wait_turn_ph': 'Wait for your turn to ask',
    'r.your_q': 'Your question',
    'r.your_q_wait': "Your question (not your turn)",
    'r.cancel_guess': 'Cancel guess',
    'r.guess_char': 'Guess character',
    'r.guess_name': 'Guess {name}',
    'r.flipped': ', flipped',
    'r.pick_guess': 'Pick the character to guess',
    'r.flip_hint': 'Click to flip the ones you ruled out · {n} left',
    'r.q_too_long': 'Questions can be 140 characters max.',
    'r.click_guess': 'Click the character you want to guess.',
    'r.guess_title': 'Guess {name}?',
    'log.v_guess': 'guessed',
    'log.v_timeout': 'ran out of time',
    'log.v_question': 'asked',
    'log.you': 'You {verb}',
    'log.name': '{name} {verb}',
    'log.name_team': '{name} (your team) {verb}',
    'log.name_side': '{name} ({side}) {verb}',
    'log.name_side_q': '{name} ({side}) {verb} your team',
    'log.waiting': '{who} · waiting',
    'log.yes': 'YES',
    'log.no': 'NO',
    'log.time': 'TIME',
    'log.hit': 'CORRECT',
    'log.miss': 'WRONG',
    'log.is_it': 'Is it {name}?',
    'log.guess': 'Guess',
    'log.no_ask': "Didn't ask in time.",
    'log.empty': 'No questions yet. Questions and answers show up here.',
    'r.observing': "Room {code} · You're watching",
    'r.queue_next': "You're next in line",
    'r.queue_nth': "You're #{n} in line",
    'r.waiting_match': 'Waiting for the match…',
    'r.s_over_w': 'Match {n} over: {side} won.',
    'r.s_ended': 'Match over.',
    'r.s_turn_duel': "{side}'s turn: {name} asks.",
    'r.s_turn_team': "{side}'s turn: {name} asks.",
    'r.s_answering': '{asker} asked "{q}" · {answerer} answers.',
    'r.offline_paren': ' (offline)',
    'r.nobody': 'Nobody',
    'r.s_asking_now': 'Asking now',
    'r.s_wait_answer': 'Waiting for the answer',
    'r.s_answering_now': 'Answering',
    'r.s_waiting': 'Waiting',
    'r.s_won': 'Won the match',
    'r.s_lost': 'Lost the match',
    'r.secret_of': 'Secret: {name}',
    'r.secret': 'Secret',
    'r.is_target': ', the target',
    'r.no_timer': 'No timer',
    'r.time_left': '{n} seconds left',
    'r.series_over': 'Series over',
    'r.match_over_n': 'Match {n} over',
    'r.t_champ_you': "You're the champion!",
    'r.t_champ_team': "You're the champions!",
    'r.t_champ': '{side} are the champions!',
    'r.t_won_you': 'You won!',
    'r.t_won_team': 'Your team won!',
    'r.t_lost_you': 'You lost!',
    'r.t_lost_team': 'Your team lost!',
    'r.t_won': '{side} won!',
    'r.reason_hit': '{who} got it: it was {name}!',
    'r.right_char': 'the right character',
    'r.reason_miss': '{who} guessed {name} and missed.',
    'r.reason_wrong': '{who} guessed wrong.',
    'r.reason_wo': 'Win by forfeit: the other side had no players connected.',
    'r.secret_duel': "{side}'s secret",
    'r.secret_team': "{side}'s secret",
    'r.wait_next': 'Waiting for {host} to start the next match…',
    'r.wait_lobby': 'Waiting for {host} to go back to the lobby…',
    'chat.room_title': 'Room chat',
    'chat.room_label': 'Message to the room',
    'chat.room_ph': 'Say hi to the room',
    'chat.team_title': 'Team chat',
    'chat.team_label': 'Message (only your team sees it)',
    'chat.team_ph': 'Plan the next question…',
    'chat.spec_title': 'Spectator chat',
    'chat.spec_label': 'Message (only spectators see it)',
    'chat.spec_ph': 'Comment on the match…',
    'chat.tab': 'Chat',
    'chat.unread': '{n} new messages',
    'chat.ch_team': 'team',
    'chat.ch_spec': 'spectators',
    'r.name_error': 'Type a nickname of 1 to 20 characters.',
    'r.pick_name': 'Pick a nickname to join.',
    'r.title': 'Cara a Cara · {name}',
  },
};

// Textos das páginas (templates), embutidos pelo servidor a partir de app/i18n.py.
let PAGES = { pt: {}, en: {} };
try {
  const el = document.getElementById('i18n-pages');
  if (el) PAGES = { ...PAGES, ...JSON.parse(el.textContent) };
} catch { /* sem textos de página: usa só DICT */ }

function store() {
  try { return window.localStorage; } catch { return null; }
}

function readCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function writeChoice(lang) {
  try {
    document.cookie = `lang=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } catch { /* cookies bloqueados */ }
  try { store()?.setItem(STORE_KEY, lang); } catch { /* sem armazenamento */ }
}

const norm = (l) => (LANGS.includes(l) ? l : null);

// Cookie manda (é o que o servidor usou); senão localStorage; senão pt. Nunca usa o idioma do navegador.
let current = norm(readCookie()) || (() => { try { return norm(store()?.getItem(STORE_KEY)); } catch { return null; } })() || 'pt';

export function getLang() { return current; }
export function locale() { return LOCALE[current]; }

/** Traduz `key` no idioma atual, interpolando `{var}`. */
export function t(key, vars) {
  let s = DICT[current]?.[key] ?? PAGES[current]?.[key] ?? DICT.pt[key] ?? PAGES.pt?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  return s;
}

const listeners = new Set();
/** Registra uma função chamada depois de cada troca de idioma. */
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Aplica o idioma atual aos elementos estáticos marcados com data-i18n*. */
export function applyPage(root = document) {
  document.documentElement.lang = HTML_LANG[current];
  document.documentElement.dataset.lang = current;
  const code = document.body?.dataset.code;
  const vars = code ? { code } : undefined;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n, vars); });
  // Só textos fixos do próprio dicionário (com <br>/<strong>); `code` é validado (A–Z, 2–9).
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml, vars); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key, vars));
    }
  });
  const titleKey = document.body?.dataset.titleKey;
  if (titleKey) document.title = t(titleKey, vars);
  root.querySelectorAll('[data-lang-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.langBtn === current));
  });
}

/** Troca o idioma sem recarregar: salva a escolha, re-traduz a página e avisa as páginas. */
export function setLang(lang) {
  const l = norm(lang);
  if (!l) return;
  writeChoice(l);
  if (l === current) { applyPage(); return; }
  current = l;
  applyPage();
  for (const fn of listeners) {
    try { fn(l); } catch (err) { console.error(err); }
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-lang-btn]');
  if (btn) setLang(btn.dataset.langBtn);
});

// Página renderizada num idioma diferente do salvo (ex.: cookie apagado, localStorage em en): alinha tudo.
if (document.documentElement.dataset.lang !== current) {
  writeChoice(current);
  applyPage();
} else if (readCookie() !== current) {
  writeChoice(current);
}
