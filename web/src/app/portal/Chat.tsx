import { useState } from 'react';
import { portal, subirArchivo } from '../api';
import { ChatBox, type Msg } from '../ChatBox';
import { PageHead, Seg } from '../ui';
import type { ModProps } from './PortalApp';
import { useAvisos } from './Notificaciones';
import { cerrarNotificaciones } from '../Campana';

/** `inicial`: canal con el que abre (campana o notificación push: #chat/CASETA). */
export function Chat({ perfil, has, inicial }: ModProps & { inicial?: string }) {
  const [canal, setCanal] = useState<'ADMIN' | 'CASETA'>(inicial === 'CASETA' && has('visitas') ? 'CASETA' : 'ADMIN');
  const tel = perfil.condominio?.telefonoCaseta;
  const { chat, refrescar } = useAvisos();
  const etiqueta = (c: 'ADMIN' | 'CASETA', t: string) => (chat[c] ? `${t} (${chat[c]})` : t);
  return (
    <div className="stack">
      <PageHead
        icon="chat"
        title="Chat"
        sub={canal === 'ADMIN' ? 'Escríbele a la administración de tu condominio.' : 'Comunícate con la caseta de vigilancia.'}
      >
        {canal === 'CASETA' && tel && (
          <a className="btn-app secondary" href={`tel:${tel.replace(/\s/g, '')}`}>
            Llamar a caseta
          </a>
        )}
      </PageHead>
      {has('visitas') && (
        <Seg value={canal} onChange={setCanal} options={[['ADMIN', etiqueta('ADMIN', 'Administración')], ['CASETA', etiqueta('CASETA', 'Caseta')]]} />
      )}
      <section className="panel">
        <ChatBox
          key={canal}
          deps={[canal]}
          miRol="RESIDENTE"
          cargar={async () => {
            // Abrir la conversación la marca como leída en el servidor; se actualizan campana y contadores.
            const r = await portal<Msg[]>('chat.mensajes', { canal });
            if (chat[canal]) refrescar();
            cerrarNotificaciones((tag) => tag.startsWith('chat-') && tag.endsWith(`#${canal}`));
            return r;
          }}
          enviar={async (texto, imagen) => portal('chat.enviar', { canal, texto, imagenPath: imagen ? await subirArchivo(imagen, 'chat') : undefined })}
        />
      </section>
    </div>
  );
}
