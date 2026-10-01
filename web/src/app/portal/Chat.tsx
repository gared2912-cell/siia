import { useState } from 'react';
import { portal } from '../api';
import { ChatBox, type Msg } from '../ChatBox';
import { PageHead, Seg } from '../ui';
import type { ModProps } from './PortalApp';

export function Chat({ perfil, has }: ModProps) {
  const [canal, setCanal] = useState<'ADMIN' | 'CASETA'>('ADMIN');
  const tel = perfil.condominio?.telefonoCaseta;
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
        <Seg value={canal} onChange={setCanal} options={[['ADMIN', 'Administración'], ['CASETA', 'Caseta']]} />
      )}
      <section className="panel">
        <ChatBox
          key={canal}
          deps={[canal]}
          miRol="RESIDENTE"
          cargar={() => portal<Msg[]>('chat.mensajes', { canal })}
          enviar={(texto) => portal('chat.enviar', { canal, texto })}
        />
      </section>
    </div>
  );
}
