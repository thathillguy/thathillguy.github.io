import React from 'react';
import '../Styles/Project.less';


export default class ContactForm extends React.Component {
    constructor(props) {
        super(props);
    }
    func(){
        this.props.toggle_modal(false);
    }
    render() {
        return(
            <div className="contactform">
                <h1 style={{float:'left', marginLeft:'12.5%', marginRight:'none', width: '75%'}}>
                    Contact Me
                </h1>
                <img  onClick={this.func.bind(this)} className="close" src="src/Resources/if_circle-close_430088.svg" />
                <input type="text" name="name" placeholder="Full Name" className="oneline"/>
                <input type="text" name="email" placeholder="Email" className="oneline"/>
                <textarea type="text" name="Message" placeholder="Message" className="message"/>
                <input className="submitbutton" type="button" value="Submit" />
             </div>
        )
    }
}
